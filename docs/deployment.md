# Deployment

Nothing here is set up yet — this is a checklist for when you're ready to take the server
off `localhost` and/or put the app on a real device permanently, not a description of an
existing pipeline.

## Server

The server is a stateless Fastify process (`server/src/index.ts`) plus a Postgres
database — deploy it anywhere that runs a Node process and gives you a Postgres instance.
None of the code assumes a specific host; two paths are documented below, but a
platform-as-a-service (Fly.io, Railway, Render) with a managed Postgres add-on works too.

### Reverse proxy: Caddy (default)

The repo ships a complete, ready-to-run production stack: Postgres + the Fastify server +
[Caddy](https://caddyserver.com) as a reverse proxy in front of it. Caddy's whole reason
for being here is that it gets you HTTPS with **zero manual certificate work** — point a
domain at your server and it obtains and renews a Let's Encrypt certificate automatically.

Files involved:

- **`Caddyfile`** — the proxy config. One real line: forward everything to the `server`
  container on port 3001 — fixed, unlike local dev's port (see
  [Automatic port selection](./development.md#automatic-port-selection)), since this
  container never publishes that port to the host at all; only Caddy is reachable from
  outside, so there's nothing for it to collide with. The hostname comes from the
  `DOMAIN` environment variable.
- **`server/Dockerfile`** — multi-stage build (installs, `prisma generate`, `tsc`), and
  runs `prisma migrate deploy` before starting on every container start (idempotent — a
  no-op once the database is current, so restarts never re-run migrations destructively).
- **`docker-compose.prod.yml`** — wires up all three containers: Postgres (no host port
  published — only the `server` container can reach it), `server` (built from the
  Dockerfile), and `caddy` (the only container exposed, on 80/443).
- **`.env.prod.example`** — copy to `.env.prod` and fill in `POSTGRES_PASSWORD`,
  `JWT_SECRET`, and `DOMAIN`.

```bash
cp .env.prod.example .env.prod   # fill in POSTGRES_PASSWORD, JWT_SECRET, DOMAIN
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Before running this: point your domain's DNS A/AAAA record at the server's public IP, and
make sure ports 80 and 443 are open to the internet (Caddy needs port 80 for the ACME
HTTP-01 challenge, even though the app is only ever served over HTTPS). Point the app at
it via `EXPO_PUBLIC_API_URL=https://your-domain`.

`DOMAIN` defaults to `localhost` if you leave `.env.prod`'s value empty and just want to
smoke-test the compose stack locally first — Caddy then serves over HTTPS using its own
internal (self-signed, not Let's Encrypt) CA, which your phone/browser won't trust by
default, but confirms the containers wire up correctly before pointing a real domain at
them.

### Build & run without Docker

If you'd rather run the server directly (e.g. on a platform-as-a-service that builds Node
apps for you), skip the Dockerfile/Caddy stack and put your own TLS termination in front
(the platform's load balancer, typically) instead:

```bash
npm --workspace=server run build   # tsc -> server/dist
npm --workspace=server run db:deploy   # prisma migrate deploy — safe to run repeatedly, never destructive
node server/dist/index.js
```

`db:deploy` (`prisma migrate deploy`) only applies migrations already committed under
`server/prisma/migrations` — it never generates a new one or prompts interactively, which
is exactly what you want in a deploy pipeline (`prisma migrate dev`, used locally while
authoring schema changes, is not safe to run unattended).

### Required environment variables

Set these for real — see [`development.md`](./development.md#environment-variables) for
what they're for; the concern here is specifically *not* using the local-dev defaults.
Using the Caddy/Docker Compose path above, these go in `.env.prod`; running the server
directly, set them however your host expects (platform env vars, a secret manager, etc).

- **`DATABASE_URL`** (direct-run path only — the Compose stack builds this for you from
  `POSTGRES_PASSWORD`) — your production Postgres, not the local dev one.
- **`POSTGRES_PASSWORD`** (Compose path only) — a strong password for the production
  Postgres container.
- **`JWT_SECRET`** — a long random value that is **not** the one `npm run setup` generated
  on your laptop. Treat it like any other credential (secret manager / platform env vars,
  never committed). Rotating it invalidates every currently-issued token — every signed-in
  device would need to sign in again.
- **`PORT`** (direct-run path only) — the code falls back to `3000` if unset
  (`server/src/index.ts`); set it explicitly so it matches whatever your host expects. The
  Compose stack always sets this to `3001` for you.
- **`DOMAIN`** (Compose path only) — your server's real hostname, so Caddy knows what to
  request a certificate for.

### Before this is reachable from outside your machine

The current code is fine for "one person, their own devices, their own network or a
trusted host" and does **not** currently have:

- **CORS restricted to specific origins** — it's registered as `{ origin: true }`
  (reflects any request's `Origin`). Native mobile requests aren't really subject to CORS
  the way a browser is, so this is low-risk for a mobile-only client, but tighten it
  (`server/src/index.ts`) if a web client is ever added.
- **Rate limiting** on `/auth/login` or `/auth/register` — nothing currently prevents a
  brute-force credential-stuffing attempt against those endpoints.
- **A refresh-token flow** — tokens are long-lived (180 days, see
  [`api-reference.md`](./api-reference.md#authentication)) with no revocation mechanism
  short of rotating `JWT_SECRET` (which logs out every device at once, not just one).

HTTPS termination itself **is** handled by default if you use the Caddy stack above; it's
only a gap if you run the server directly and skip putting anything in front of it (Fastify
itself listens on plain HTTP — a JWT sent over that is trivially interceptable).

None of this matters for local development against `localhost`/your own LAN — it starts
mattering the moment the server is reachable from the open internet.

## Mobile app

Two distinct things, easy to conflate:

- **OTA (JavaScript) updates** — shipping a code change to an already-installed build
  without going through an app store. Covered in
  [`development.md`](./development.md#ota-updates) (`eas update`). This only works for
  JS/asset changes; anything touching native code (a new native dependency, an
  `app.json` config change with native effect) needs a new build.
- **Binary distribution** — actually getting an installable build onto a device: Expo Go
  (dev-only, what this project has used so far), an EAS Build development/internal build
  (installable `.apk`/`.ipa` shared directly, no store review), or a full App
  Store/Play Store release. None of this is configured yet — it starts with
  `eas build:configure` in `app/`, which is a separate step from `eas update:configure`.

For a genuinely personal app (you, your own phone), an EAS internal-distribution build is
usually the right stopping point — no store review, no public listing, just an installable
binary plus OTA updates on top of it.
