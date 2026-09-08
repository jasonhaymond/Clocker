# Deployment

Nothing here is set up yet — this is a checklist for when you're ready to take the server
off `localhost` and/or put the app on a real device permanently, not a description of an
existing pipeline.

## Server

The server is a stateless Fastify process (`server/src/index.ts`) plus a Postgres
database — deploy it anywhere that runs a Node process and gives you a Postgres instance:
a single VPS with Docker Compose (extending the existing `docker-compose.yml` with the
server itself), or a platform-as-a-service (Fly.io, Railway, Render) with a managed
Postgres add-on. None of the code assumes a specific host.

### Build & run

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
what they're for; the concern here is specifically *not* using the local-dev defaults:

- **`DATABASE_URL`** — your production Postgres, not the Docker Compose one.
- **`JWT_SECRET`** — a long random value that is **not** the one `npm run setup` generated
  on your laptop. Treat it like any other credential (secret manager / platform env vars,
  never committed). Rotating it invalidates every currently-issued token — every signed-in
  device would need to sign in again.
- **`PORT`** — the code falls back to `3000` if unset (`server/src/index.ts`); set it
  explicitly so it matches whatever your host expects.

### Before this is reachable from outside your machine

The current code is fine for "one person, their own devices, their own network or a
trusted host" and does **not** currently have:

- **CORS restricted to specific origins** — it's registered as `{ origin: true }`
  (reflects any request's `Origin`). Native mobile requests aren't really subject to CORS
  the way a browser is, so this is low-risk for a mobile-only client, but tighten it
  (`server/src/index.ts`) if a web client is ever added.
- **Rate limiting** on `/auth/login` or `/auth/register` — nothing currently prevents a
  brute-force credential-stuffing attempt against those endpoints.
- **HTTPS termination** — Fastify listens on plain HTTP; put it behind a reverse proxy or
  platform load balancer that terminates TLS before this goes anywhere untrusted (a JWT
  sent over plain HTTP is trivially interceptable).
- **A refresh-token flow** — tokens are long-lived (180 days, see
  [`api-reference.md`](./api-reference.md#authentication)) with no revocation mechanism
  short of rotating `JWT_SECRET` (which logs out every device at once, not just one).

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
