# Deployment

## Dev stack vs. production stack — don't run one thinking it's the other

Clocker has **two completely separate ways to run the server**, and mixing them up is the
most common way to end up with "I deployed it but it's not running / not reachable":

| | `npm run dev:server` | `docker-compose.prod.yml` |
|---|---|---|
| What it is | `tsx watch` running the server directly, in your terminal | Postgres + server + Caddy, all in Docker |
| Survives you logging out? | **No** — it's a foreground process tied to your shell session. Close the terminal/SSH connection (or the process crashes) and it's gone, with nothing to restart it. | **Yes** — every container has `restart: unless-stopped`; Docker brings them back after a crash or a host reboot. |
| Reachable from the internet? | Only the raw port it's listening on (whatever `server/.env`'s `PORT` is) — nothing terminates TLS, and that port almost certainly isn't open in your firewall/cloud security group. | Only Caddy's 80/443, which proxy to the server internally. HTTPS included. |
| What it's for | Local development on your own laptop, actively watching for `dev:server`'s output while you work. | An actual deployment: a server you point a real domain at and walk away from. |

**If you want this running persistently on a server — reachable after you disconnect,
surviving a reboot — use the production stack below, not `npm run setup` /
`npm run dev:server`.** Those are documented in [`development.md`](./development.md) and
are for your own workstation.

## Quick start: production deployment (Caddy + Docker Compose)

Everything needed is already in the repo — nothing to write, just to configure and run.

### Prerequisites

Confirm all of these *before* starting the stack — every one of them causes exactly the
"redeployed but it's not running or inaccessible" symptom if skipped:

- **Docker and Docker Compose are installed** on the server (`docker --version` and
  `docker compose version` both succeed).
- **DNS is pointed at this server already.** An A (and/or AAAA) record for your domain
  resolving to this machine's public IP. Check from *outside* the server (your laptop,
  not the server itself — a server can sometimes resolve things a client can't):
  ```bash
  dig +short your-domain.com
  ```
  This should print the server's public IP. If it prints nothing or a different IP, fix
  DNS first and wait for it to propagate (can take minutes to hours) — Caddy cannot get a
  certificate for a domain that doesn't resolve to it.
- **Ports 80 and 443 are open to the internet on this exact machine** — both in any OS
  firewall (`ufw`, `firewalld`) and in front of it (a cloud provider's security group, a
  home router's port forwarding if this is behind NAT). Port 80 matters even though the
  app is only ever served over HTTPS: Caddy needs it for the ACME HTTP-01 challenge that
  proves you control the domain. Check from outside the server:
  ```bash
  curl -I http://your-domain.com   # before the stack is even running, expect a connection
                                     # refused/timeout if the port isn't reachable yet
  ```
- **Nothing else is already bound to 80/443** on this machine (another web server, a
  previous Caddy instance, etc.) — `docker compose up` will fail to start the `caddy`
  container if so. Check with `sudo ss -tlnp | grep -E ':80|:443'`.
- **You're not simultaneously running the dev stack's Postgres** on this machine with a
  conflicting setup — see [Migrating from the dev stack](#migrating-from-the-dev-stack)
  below if you'd been running `npm run setup` / `npm run dev:server` here.

### 1. Get the code

```bash
git clone https://github.com/<you>/Clocker.git   # or `git pull` if it's already cloned
cd Clocker
```

### 2. Deploy

```bash
npm run deploy -- your-domain.com
```

This is `scripts/deploy.mjs`. `POSTGRES_PASSWORD` and `JWT_SECRET` don't need to be typed
in anywhere — the first time it runs, it generates both randomly and writes them to
`.env.prod` alongside the domain you passed, the same way `npm run setup` generates a
`JWT_SECRET` for local dev. It then builds the server's Docker image, starts Postgres,
the server (which runs `prisma migrate deploy` automatically), and Caddy, and finally
checks the result itself:

- polls until all three containers report running (and tells you which command to check
  logs with if one doesn't, instead of just hanging)
- does a `dig` on your domain first and warns (non-fatally — Caddy retries on its own) if
  it doesn't resolve yet
- curls `https://your-domain.com/health` through Caddy and reports whether that actually
  succeeded, rather than declaring victory just because `docker compose up` didn't error

Re-running `npm run deploy` later (e.g. after `git pull`-ing new code) reuses everything
already in `.env.prod` — you only ever pass the domain once. To pin a specific
password/secret instead of a generated one, edit `.env.prod` before running it; the
script fills in only whatever's still blank.

If a specific step fails, it tells you which command to run for more detail. To do the
same thing by hand instead — useful if you want to see every step, or `npm run deploy`
doesn't fit your setup — see [Manual setup, without the deploy script](#manual-setup-without-the-deploy-script)
below.

Once it succeeds, point the app at it:

```bash
EXPO_PUBLIC_API_URL=https://your-domain.com
```

### Manual setup, without the deploy script

Equivalent to what `npm run deploy` automates, spelled out:

```bash
cp .env.prod.example .env.prod
```

Edit `.env.prod` and fill in all three values (generate `JWT_SECRET` rather than typing
something memorable: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`):

```bash
# .env.prod
POSTGRES_PASSWORD=<a strong password — this is a NEW production database, not your dev one>
JWT_SECRET=<a long random value>
DOMAIN=your-domain.com
```

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Then verify it yourself — don't just assume it started because the command didn't error:

```bash
# 1. All three containers should show "Up" / "running", not "Restarting" or "Exited"
docker compose -f docker-compose.prod.yml --env-file .env.prod ps

# 2. Watch the server actually come up and migrate cleanly
docker compose -f docker-compose.prod.yml --env-file .env.prod logs server
#   look for "All migrations have been successfully applied" and
#   "Server listening at http://..." — if it's crash-looping instead, this is where you'll see why

# 3. Confirm Caddy got a real certificate (not stuck retrying)
docker compose -f docker-compose.prod.yml --env-file .env.prod logs caddy
#   look for "certificate obtained successfully" — repeated "obtaining certificate" /
#   error lines mean DNS or port 80 isn't actually reachable from the internet yet (see Prerequisites)

# 4. Hit it for real, from outside the server (your laptop, not an SSH session on the box)
curl https://your-domain.com/health
#   expect: {"ok":true}
```

### Migrating from the dev stack

If you'd previously been running the dev workflow (`npm run setup` /
`npm run dev:server`, `docker-compose.yml`) on this same machine and want to switch it
over to the real production stack:

```bash
# Stop the dev Postgres container (add -v too if you don't need its data — a fresh
# production deployment starts with an empty database either way, since it's a
# different Postgres instance/volume entirely)
docker compose down -v

# If dev:server is running in a screen/tmux/nohup session, stop that process too —
# find it and kill it, or just close that terminal session
```

Then follow the Quick start above. The dev stack (plain `docker-compose.yml`, whatever
port `npm run setup` picked) and the production stack (`docker-compose.prod.yml`, always
80/443 via Caddy) are entirely separate — nothing about one affects the other's
configuration, but they can't both use the same Postgres port unless you've stopped one.

### Troubleshooting

| Symptom | Likely cause |
|---|---|
| `docker compose up` fails immediately, mentions port 80 or 443 | Something else already has that port — see [Prerequisites](#prerequisites). Find it with `sudo ss -tlnp \| grep -E ':80\|:443'` and stop it, or stop it if it's a previous Caddy container (`docker ps -a`). |
| Caddy logs repeat "obtaining certificate" and never say "obtained successfully" | DNS doesn't actually point here yet, or port 80 isn't reachable from the internet (a cloud firewall/security group is the usual culprit — the *server's own* `ufw`/`firewalld` can look fine while a provider-level firewall still blocks it). |
| `curl https://your-domain.com/health` hangs or refuses | Either Caddy isn't up (`docker compose -f docker-compose.prod.yml ps`) or port 443 isn't actually open from the internet — check from your laptop, not from the server itself (localhost can "work" even when nothing external can reach it). |
| `server` container shows "Restarting" in `ps` | It's crash-looping — read `docker compose -f docker-compose.prod.yml logs server` for the actual error, usually a missing/wrong env var or a database connection failure. |
| Everything looks up, but the app can't reach it | `EXPO_PUBLIC_API_URL` is pointed at the wrong thing — it must be `https://your-domain.com` (through Caddy), never a raw container port like `:3001`, which is never published to the host at all. |
| You ran `npm run setup`/`npm run dev:server` here and it "stopped working" | That's the dev workflow, not a deployment — see [Dev stack vs. production stack](#dev-stack-vs-production-stack--dont-run-one-thinking-its-the-other) above. Switch to the production stack instead of trying to keep the dev process alive. |

## How the stack fits together

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
- **`.env.prod.example`** — the template `.env.prod` is copied from.

`DOMAIN` defaults to `localhost` if you leave `.env.prod`'s value empty and just want to
smoke-test the compose stack locally first — Caddy then serves over HTTPS using its own
internal (self-signed, not Let's Encrypt) CA, which your phone/browser won't trust by
default, but confirms the containers wire up correctly before pointing a real domain at
them.

## Running the server without Docker

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

This path needs the same "survives you logging out" plan the Docker stack gets for free —
run it under a process manager (systemd, pm2) or your platform's own process supervisor,
not directly in a terminal, for the same reason described in
[Dev stack vs. production stack](#dev-stack-vs-production-stack--dont-run-one-thinking-its-the-other) above.

## Required environment variables

Set these for real — see [`development.md`](./development.md#environment-variables) for
what they're for; the concern here is specifically *not* using the local-dev defaults.
Using the Caddy/Docker Compose path above, `npm run deploy` generates `POSTGRES_PASSWORD`
and `JWT_SECRET` into `.env.prod` for you (see [Deploy](#2-deploy)) — only `DOMAIN` is
yours to supply. Running the server directly, set all of these however your host expects
(platform env vars, a secret manager, etc) — nothing generates them for you on that path.

- **`DATABASE_URL`** (direct-run path only — the Compose stack builds this for you from
  `POSTGRES_PASSWORD`) — your production Postgres, not the local dev one.
- **`POSTGRES_PASSWORD`** — a strong password for the production Postgres container.
  Auto-generated by `npm run deploy`; set it yourself in `.env.prod`/your host's env vars
  on the direct-run path.
- **`JWT_SECRET`** — a long random value that is **not** the one `npm run setup` generated
  on your laptop. Auto-generated by `npm run deploy`, same as above otherwise. Treat it
  like any other credential (secret manager / platform env vars, never committed).
  Rotating it invalidates every currently-issued token — every signed-in device would
  need to sign in again.
- **`PORT`** (direct-run path only) — the code falls back to `3000` if unset
  (`server/src/index.ts`); set it explicitly so it matches whatever your host expects. The
  Compose stack always sets this to `3001` for you.
- **`DOMAIN`** (Compose path only) — your server's real hostname, so Caddy knows what to
  request a certificate for. The one value `npm run deploy` can't generate for you — pass
  it as an argument the first time (`npm run deploy -- your-domain.com`).

## Security gaps to close before this is public

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
