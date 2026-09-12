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
This walks through the default setup, where the bundled Caddy owns ports 80/443 directly.
**Already running your own reverse proxy** (a separate Caddy, possibly on another
machine, nginx, Traefik, ...) and want to add Clocker to it instead? Skip to
[Deploying behind your own reverse proxy](#deploying-behind-your-own-reverse-proxy) —
everything else on this page (the Prerequisites below aside — DNS/ports 80/443 are only
relevant to the bundled-Caddy path) still applies.

### Prerequisites

Confirm every one of these *before* starting the stack — each one causes exactly the
"redeployed but it's not running or inaccessible" symptom if skipped.

- [ ] **Docker and Docker Compose are installed** on the server:
  ```bash
  docker --version && docker compose version
  ```
  Both should print a version, not an error.
- [ ] **DNS is pointed at this server already.** Check from *outside* the server (your
  laptop, not the server itself — a server can sometimes resolve things a client can't):
  ```bash
  dig +short your-domain.com
  ```
  This should print the server's public IP. If it prints nothing or a different IP, fix
  DNS first (an A and/or AAAA record for your domain) and wait for it to propagate (can
  take minutes to hours) — Caddy cannot get a certificate for a domain that doesn't
  resolve to it.
- [ ] **Ports 80 and 443 are open to the internet on this exact machine** — both in any OS
  firewall (`ufw`, `firewalld`) and in front of it (a cloud provider's security group, a
  home router's port forwarding if this is behind NAT). Port 80 matters even though the
  app is only ever served over HTTPS: Caddy needs it for the ACME HTTP-01 challenge that
  proves you control the domain. Check from outside the server:
  ```bash
  curl -I http://your-domain.com   # before the stack is even running, expect a connection
                                     # refused/timeout if the port isn't reachable yet
  ```
- [ ] **Nothing else is already bound to 80/443** on this machine (another web server, a
  previous Caddy instance, etc.):
  ```bash
  sudo ss -tlnp | grep -E ':80|:443'
  ```
  Empty output is what you want. If something's listed, `docker compose up` will fail to
  start the `caddy` container.
- [ ] **You're not simultaneously running the dev stack's Postgres** on this machine with
  a conflicting setup — see [Migrating from the dev stack](#migrating-from-the-dev-stack)
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

Once it succeeds, point the app at it. For local development against this server
(`npx expo start` / Expo Go), the persistent way is a **file**, not a shell command:

```bash
# app/.env — copy from app/.env.example if it doesn't exist yet
EXPO_PUBLIC_API_URL=https://your-domain.com
```

Expo loads `app/.env` automatically (no extra config) whenever you run `npm run dev:app`
or `npx expo start` from `app/` — see
[`development.md`](./development.md#environment-variables). Building an actual
installable app (not just running it in Expo Go) needs the same variable set a different
way, since a build bakes it in rather than reading a file on your machine at the time —
see [Deploying the Expo app](#deploying-the-expo-app) below.

### Manual setup, without the deploy script

Equivalent to what `npm run deploy` automates, spelled out step by step.

1. Copy the template env file:
   ```bash
   cp .env.prod.example .env.prod
   ```
2. Generate a strong `JWT_SECRET`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
3. Edit `.env.prod` and fill in all three values (paste the secret from step 2):
   ```bash
   # .env.prod
   POSTGRES_PASSWORD=<a strong password — this is a NEW production database, not your dev one>
   JWT_SECRET=<the value generated in step 2>
   DOMAIN=your-domain.com
   ```
4. Build and start the stack:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
   ```
5. Verify it yourself — don't just assume it started because the command didn't error.
   Run each of these in order; stop and troubleshoot at the first one that doesn't match:
   1. All three containers should show "Up" / "running", not "Restarting" or "Exited":
      ```bash
      docker compose -f docker-compose.prod.yml --env-file .env.prod ps
      ```
   2. Watch the server actually come up and migrate cleanly:
      ```bash
      docker compose -f docker-compose.prod.yml --env-file .env.prod logs server
      ```
      Look for "All migrations have been successfully applied" and "Server listening
      at http://..." — if it's crash-looping instead, this is where you'll see why.
   3. Confirm Caddy got a real certificate (not stuck retrying):
      ```bash
      docker compose -f docker-compose.prod.yml --env-file .env.prod logs caddy
      ```
      Look for "certificate obtained successfully" — repeated "obtaining certificate" /
      error lines mean DNS or port 80 isn't actually reachable from the internet yet (see
      Prerequisites above).
   4. Hit it for real, from outside the server (your laptop, not an SSH session on the
      box):
      ```bash
      curl https://your-domain.com/health
      ```
      Expect: `{"ok":true}`.

### Migrating from the dev stack

If you'd previously been running the dev workflow (`npm run setup` /
`npm run dev:server`, `docker-compose.yml`) on this same machine and want to switch it
over to the real production stack:

1. Stop the dev Postgres container (add `-v` too if you don't need its data — a fresh
   production deployment starts with an empty database either way, since it's a
   different Postgres instance/volume entirely):
   ```bash
   docker compose down -v
   ```
2. If `dev:server` is running in a screen/tmux/nohup session, stop that process too —
   find it and kill it, or just close that terminal session.
3. Follow the [Quick start](#quick-start-production-deployment-caddy--docker-compose)
   above from the top.

The dev stack (plain `docker-compose.yml`, whatever
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
| (`--external-proxy`) Your other proxy gets a connection error/timeout reaching Clocker | Port `SERVER_PORT` isn't actually reachable from the proxy's machine — check the firewall rule is scoped to (and allows) the proxy's real IP, and that `SERVER_BIND` in `.env.prod` isn't set to an address the proxy can't route to. |
| (`--external-proxy`) `http://localhost:<port>/health` works on this machine but the domain still doesn't resolve through your proxy | That's your *other* proxy's configuration/DNS, not this stack — confirm the site block was actually added and reloaded there, and that domain's DNS points at *that* proxy (not this machine). |
| "Update Server" or Settings → Backups fails with "Request failed (405)" | Your reverse proxy's config is missing the `/update*`/`/backup*` `handle` blocks (added when the host agent shipped in `1.1.0` — an older external-proxy config predates them), so the request falls through to the catch-all and hits the `web` container's static file server, which only answers GET/HEAD. Re-run `npm run deploy -- your-domain.com --external-proxy` (bundled Caddy: nothing to do, this can't happen there) and paste the freshly printed snippet into your proxy's config, replacing what's there now. |
| The site shows recent UI changes but Settings → Backups still shows old behavior (e.g. "Generating..." with no error) | The `web`/`server` Docker containers got rebuilt, but `scripts/host-agent.mjs` (a separate pm2/systemd process, not a container) didn't restart with the new code — `git pull` alone doesn't restart a running Node process. Run `pm2 restart clocker-host-agent` (or the systemd equivalent) directly, or re-run `npm run deploy` and confirm it reaches that step. |

## Deploying behind your own reverse proxy

If you already run a reverse proxy — a separate Caddy (possibly on a different machine,
already fronting other services), nginx, Traefik, whatever — you don't need the bundled
one from the Quick start above fighting it for ports 80/443. `PROXY_MODE=external` skips
it entirely: Postgres, the server, and the web client still run in Docker here, but
instead of a `caddy` container, the server's and web client's own ports are each
published for *your* proxy to reach.

### Steps

1. Run the deploy script with `--external-proxy`:
   ```bash
   npm run deploy -- your-domain.com --external-proxy
   ```
2. **Firewall both published ports to your proxy's specific IP** — this is the important
   step, not optional (see the security note below):
   ```bash
   ufw allow from <proxy-ip> to any port <SERVER_PORT>
   ufw allow from <proxy-ip> to any port <WEB_PORT>
   ```
   (`<SERVER_PORT>`/`<WEB_PORT>` are whatever the deploy script printed/wrote to
   `.env.prod` — see [Automatic port selection](./development.md#automatic-port-selection);
   `WEB_PORT` is always picked *after* `SERVER_PORT` so the two can never collide.)
3. Copy the Caddy site block the deploy script printed at the end, add it to your other
   proxy's own config, and reload it (`caddy reload` or your proxy's equivalent). See
   [What the deploy script prints](#what-the-deploy-script-prints) below for the exact
   format and what to fill in.
4. Verify from *outside* this machine, through your actual proxy:
   ```bash
   curl https://your-domain.com/health
   curl https://your-domain.com/
   ```
   Expect `{"ok":true}` from the first (the API) and real HTML back from the second (the
   web client) — both under the *same* domain, since your proxy path-routes between them
   the same way the bundled Caddyfile does. If either doesn't work, re-check step 3 (site
   block actually added and reloaded, domain's DNS points at *that* proxy) before
   assuming this stack is at fault — see the [Troubleshooting](#troubleshooting) table
   above.

### What's different from the default (local) mode

- Uses `docker-compose.prod.external-proxy.yml` instead of `docker-compose.prod.yml` — no
  `caddy` service at all; nothing here ever touches ports 80/443.
- Auto-picks a free host port for the server the *first* time (starting at 3001), then a
  free port for the web client *starting after whatever `SERVER_PORT` ended up being* (so
  they never collide), published as `SERVER_PORT`/`WEB_PORT` in `.env.prod`. Unlike local
  dev's [Automatic port selection](./development.md#automatic-port-selection), these are
  **not** re-verified on every later redeploy — once set, a production port is reused
  unconditionally. This is deliberate, not the dev behavior forgotten: a plain "is this
  port free" check can't tell "taken by something else" apart from "taken by this same
  stack's own already-running container," so re-checking on every run would see its own
  server/web container occupying the port and conclude it needs a *different* one —
  incrementing forever on every redeploy, never actually settling. If a configured port
  is ever genuinely unavailable (something unrelated grabbed it while this stack was
  down), `docker compose up` fails with a clear "port already allocated" error — fix it by
  hand then (edit `SERVER_PORT`/`WEB_PORT` in `.env.prod`), the same as changing a dev
  port.
- Publishes both ports on `SERVER_BIND`/`WEB_BIND` (default `0.0.0.0`, i.e. every
  interface) since your proxy might be reachable only from elsewhere on the network —
  **this means the server and web client are each reachable as plain HTTP on their port
  from anywhere that can reach this machine's IP, not just your proxy**, until you
  complete step 2 above. Optionally also set `SERVER_BIND`/`WEB_BIND` in `.env.prod` to a
  private/internal IP this host has (e.g. a VPC-internal address, a Tailscale IP) if you
  have one your proxy can reach, instead of leaving them bound to every interface — the
  firewall rule in step 2 is still the important part regardless.
- Skips the DNS-must-resolve-for-Let's-Encrypt check and the "reach it over HTTPS through
  Caddy" verification — nothing here handles TLS or knows your domain's DNS state, so it
  instead confirms the server and web client each answer directly over plain HTTP
  (`http://localhost:<SERVER_PORT>/health`, `http://localhost:<WEB_PORT>/`) on this
  machine. Reaching them through *your* proxy, on one domain, is what step 4 above checks
  separately.

### What the deploy script prints

At the end of a successful run, with your real domain and both ports already filled in —
the same path-based routing (API's fixed set of routes to `server`, everything else to
`web`) as the bundled Caddyfile, just written for your proxy's config instead:

```caddyfile
your-domain.com {
    handle /health {
        reverse_proxy <this-machine's-address>:<server-port>
    }
    handle /auth/* {
        reverse_proxy <this-machine's-address>:<server-port>
    }
    handle /sync/* {
        reverse_proxy <this-machine's-address>:<server-port>
    }
    handle {
        reverse_proxy <this-machine's-address>:<web-port>
    }
}
```

Replace `<this-machine's-address>` with whatever your proxy can use to reach this host
(its LAN IP, a private network hostname, a VPN/Tailscale address) — that's the one value
the script can't know for you. Not using Caddy on the far end? Translate the same
"path → this host:port" rules into nginx/Traefik/whatever config format that proxy uses
(nginx: `location` blocks; Traefik: path-prefix routers) — the routing logic is identical,
just different syntax.

Switching modes later (`--local-proxy` to switch back, or just `--external-proxy` again
after having used local) is safe — `npm run deploy` detects the change and stops the
previous mode's containers first, before starting the new ones, so you never end up with
both running at once under the same project name.

Re-run `npm run deploy` (no flags needed once a mode is chosen) any time you want to
rebuild and restart with the latest code — it reuses the domain, generated
password/secret, mode, and both ports already in `.env.prod`.

## How the stack fits together

- **`Caddyfile`** — the proxy config, one site block for `$DOMAIN` that path-routes: the
  API's fixed set of routes (`/health`, `/auth/*`, `/sync/*`) go to the `server`
  container on port 3001 — fixed, unlike local dev's port (see
  [Automatic port selection](./development.md#automatic-port-selection)), since this
  container never publishes that port to the host at all — and everything else falls
  through to the `web` container. Only Caddy is reachable from outside, so neither
  internal port has anything to collide with.
- **`server/Dockerfile`** — multi-stage build (installs, `prisma generate`, `tsc`), and
  runs `prisma migrate deploy` before starting on every container start (idempotent — a
  no-op once the database is current, so restarts never re-run migrations destructively).
- **`web/Dockerfile`** — multi-stage build for the web client (see
  [Deploying the web client](#deploying-the-web-client) above); unlike `server/Dockerfile`
  its build context is the *monorepo root*, since it needs the sibling `shared` workspace.
  Final stage is a small Caddy (`web/Caddyfile`) just serving the static build — no Node
  runtime in the shipped image.
- **`docker-compose.prod.yml`** — wires up Postgres (no host port published — only the
  `server` container can reach it), `server` and `web` (neither publishes a host port —
  only `caddy` can reach them, over the compose network), and `caddy` (the only container
  exposed, on 80/443). Used for `PROXY_MODE=local` (the default); all four containers
  start on a plain `up`, no flag needed.
- **`docker-compose.prod.external-proxy.yml`** — the alternate stack for
  `PROXY_MODE=external` (see [Deploying behind your own reverse proxy](#deploying-behind-your-own-reverse-proxy)):
  same Postgres + server + web, no `caddy` service, and the server's and web client's
  ports are each published to the host instead of only being reachable internally.
- **`.env.prod.example`** — the template `.env.prod` is copied from.

`DOMAIN` defaults to `localhost` if you leave `.env.prod`'s value empty and just want to
smoke-test the compose stack locally first — Caddy then serves over HTTPS using its own
internal (self-signed, not Let's Encrypt) CA, which your phone/browser won't trust by
default, but confirms the containers wire up correctly before pointing a real domain at
them.

## The host agent

**Why this exists.** The server itself runs inside Docker, so it has no access to the
host's git repo, Docker socket, or arbitrary host filesystem paths by design — giving it
that access would let a compromised server container control the whole Docker host.
Two features need exactly that kind of host access anyway: triggering a full redeploy,
and taking a real Borg backup (which needs `docker compose exec` to reach Postgres, plus
the host's `.env.prod` for the secrets half of a backup). Rather than punch a hole in the
container for either, `npm run deploy` also starts a small script,
`scripts/host-agent.mjs`, directly on the host (never inside a container), exposing a
handful of HTTP endpoints both clients' Settings screens call. Because it runs on the
host, it keeps running (and can report status) even while an update it triggers rebuilds
and restarts every container, the API server included.

**Auth** reuses `JWT_SECRET` from `.env.prod` for every endpoint below — the host agent
verifies the same bearer token the app already sends to `/sync/*`, rather than a separate
secret to configure per device. This is appropriate for a personal single-user app (any
signed-in device can already read/write all of that user's data); it would need real
access control before use by more than one trusted person.

**Reachability**: `npm run deploy` auto-picks `HOST_AGENT_PORT`/`HOST_AGENT_BIND` in
`.env.prod` (same "scanned once, then reused forever" rule as `SERVER_PORT`/`WEB_PORT`)
and routes `/update*` and `/backup*` to it under the same domain as everything else — the
bundled Caddyfile reaches it via `host.docker.internal`; the external-proxy snippet gets
its own `handle` blocks for both, alongside `/health`/`/auth/*`/`/sync/*`. If you're on
`PROXY_MODE=external`, re-paste the updated snippet into your proxy after your first
deploy with this feature.

**Starting the service**: `npm run deploy` starts/restarts it under pm2 automatically if
pm2 is installed (`npm install -g pm2`) and prints a warning with the manual command if
not. To run it under systemd instead:

```ini
# /etc/systemd/system/clocker-host-agent.service
[Unit]
Description=Clocker host agent
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/Clocker
ExecStart=/usr/bin/node scripts/host-agent.mjs
Restart=on-failure
User=<your-deploy-user>

[Install]
WantedBy=multi-user.target
```

then `systemctl enable --now clocker-host-agent`. Either way, `npm run deploy` still
manages everything else (containers, DB snapshot, EAS build) the same as before — the
host agent is the one piece that has to live outside that, on the host.

### Triggering an update from the app

Settings on both clients has an "Update Server" button — tap it and the server pulls the
latest committed code and redeploys (`git pull --ff-only && npm install && npm run deploy
-- --skip-app`), without you having to SSH in. It deliberately skips the mobile app build
(a UI button shouldn't silently kick off an EAS cloud build); a full rebuild including the
app still goes through `npm run deploy` by hand, or `npm run deploy:app` for a JS-only OTA
update. Refuses to run if the host's working tree has uncommitted changes, or if an update
is already in progress — with one deliberate exception: a locally modified
`package-lock.json` (e.g. from an `npm install` run directly on the host outside this
flow, as happened once in practice — see `STATUS.md`) is discarded automatically before
the check, since it's fully regenerated by the `npm install` step above regardless and
drifts machine-to-machine even when nothing meaningful changed. The one case that's left
alone as a real uncommitted change: `package.json` is *also* locally modified, since that
pairing usually means an intentional, uncommitted dependency change in progress, not just
drift — see `discardSafeLockfileDrift` in `scripts/lib.mjs` (shared with `scripts/
update.mjs`'s own `git pull`, so both stay consistent).

**Limits, deliberately not addressed**: no rollback if the pulled commit is broken (same
as running `npm run deploy` by hand); no queue (a second tap while one is running, or while
a backup/restore is running, is rejected with an "already running" error, not queued).

### Backups (BorgBackup)

Settings → Backups on both clients configures and triggers encrypted, deduplicated
backups via [BorgBackup](https://borgbackup.readthedocs.io/), instead of relying only on
the plain `pg_dump` snapshot `npm run deploy` already takes before every deploy (that one
stays — it's a quick pre-deploy rollback point, not a retained backup history). Requires
`borg` installed on the host (`apt install borgbackup` on Debian/Ubuntu; the host agent
logs a warning at startup if it's missing).

**What's backed up, and how**: each run stages a `pg_dump -Fc` (custom format) of the
database plus a copy of `.env.prod` (the secrets a database-only backup can't recover —
per the global backup standard, a restore that only brings back the database still leaves
the app unable to start) into a temp directory, then `borg create --compression zstd
<repo>::clocker-<timestamp> .`. If a retention count is set, `borg prune --keep-last N`
runs afterward — a single most-recent-N count, not tiered daily/weekly/monthly retention.

**Where it's configured**: unlike everything else in `.env.prod`, backup settings
(repo URL, passphrase, retention, schedule) live in their own file on the host,
`.backup-config.json` (gitignored), managed entirely through the app's Settings → Backups
screen — there's nothing to hand-edit. This is deliberate: the main server has no host
filesystem access (same reason the host agent exists at all), so it can't be the thing
storing these settings in its own database the way a less-sandboxed app might.

**Repository location** — either:
- **A local path** on the same disk (e.g. `/mnt/backups/clocker`), simplest to set up but
  — per the global backup standard — doesn't protect against this host itself failing.
- **A remote SSH target** (`user@host:path`), which does. The host agent generates a
  dedicated Ed25519 keypair on first use (`.backup-ssh/`, gitignored, isolated from any
  ambient SSH identity on this host) — that key needs a **dedicated, restricted account**
  on the backup server rather than access to your own login, so it's useless for anything
  else even if it were ever leaked. Settings → Backups has a "Set up a dedicated backup
  user on the remote server" toggle right under the generated key that prints the exact
  copy-pasteable commands (creates a system user with a `nologin` shell, the repository
  directory, and a restricted `authorized_keys` entry scoped to just `borg serve` against
  that one repository) — use that instead of retyping the commands here, so there's one
  source of truth (`shared/src/backupRemoteSetup.ts`) instead of two that can drift apart.
  Default convention it follows: user `clocker-backup`, repository
  `/srv/clocker-backup/repositories/clocker`. Borg initializes the repository itself
  (`borg init --encryption repokey-blake2`) the first time it's used — the directory and
  the restricted `authorized_keys` entry are yours to set up (this is exactly the kind of
  system-level, another-host config this project won't automate — see the global
  standard's automation risk-tiering).

**The passphrase is genuinely unrecoverable if lost** — repokey-blake2 encryption derives
the key from it, and it's stored write-only (Settings never redisplays it, only whether
one is set). Save it somewhere real (a password manager) the moment you set it; there's no
recovery path in this app if it's lost, only for-the-future rotation.

**Restoring**: pick an archive in Settings → Backups, choose database and/or secrets, type
the archive's name to confirm (matches Haydrop's own restore-confirmation pattern), and
restore. Before touching anything, the host agent takes its own quick pre-restore
`pg_dump --clean --if-exists` safety snapshot to `backups/` — independent of Borg
entirely — so a bad restore is itself recoverable. Restoring secrets that changed
`JWT_SECRET` signs every device out; restoring the database always runs `pg_restore
--clean --if-exists`, which drops and recreates existing objects rather than merging.

**Scheduling**: the plain-language picker (Off/Daily/Weekly/Monthly + time) is converted
to a cron string by the host agent itself (`node-cron`) — no cron syntax to write by hand,
and no separate reboot-persistent cron entry to maintain, since the schedule re-arms
automatically whenever the host agent (re)starts or the schedule is saved.

**Never verified against a real `borg` binary from any Claude session** (no `borg`
installed on the Windows dev machine this was built on) — the HTTP layer, config
persistence, cron round-tripping, and the crash this exact gap already caused once (a
config-validation guard that threw outside its own try/catch, taking down the whole host
agent process on the very first un-configured trigger — fixed, and now covered by the
synchronous pre-check on both trigger routes) were all exercised for real. The actual
`borg create`/`list`/`extract` invocations were not. Treat the first real backup and the
first real restore on production as the actual test of this feature, not a formality —
watch `pm2 logs clocker-host-agent` or the in-app log viewer closely.

## Database backups

Every `npm run deploy` run takes an unconditional `pg_dump` snapshot to
`backups/clocker-<timestamp>.sql` (gitignored) *before* touching anything — independent of
any other backup mechanism, and skipped gracefully on a brand-new deployment where
there's no existing database yet. This is cheap insurance, not a full backup strategy: it
only runs at deploy time, only lives on this one host's disk, and there's no retention
policy pruning old ones — copy them somewhere else (another machine, object storage) for
anything that actually matters, and prune `backups/` yourself periodically. For an actual
retained, encrypted, optionally off-host backup history — the thing that "actually
matters" above is pointing at — see [Backups (BorgBackup)](#backups-borgbackup).

To restore one:

```bash
cat backups/clocker-<timestamp>.sql | docker compose -f <compose-file> --env-file .env.prod exec -T postgres psql -U clocker clocker
```

(`<compose-file>` is whichever of `docker-compose.prod.yml` / `docker-compose.prod.external-proxy.yml`
matches your current `PROXY_MODE`.) The dump includes `DROP ... IF EXISTS` before each
object (`pg_dump --clean --if-exists`), so this is safe to run whether the target already
has the schema (the common "just lost some rows" case) or is a completely fresh, empty
database. Verified end to end: created a real row, redeployed to snapshot it, deliberately
truncated the table, restored from the snapshot, and confirmed the exact row came back —
zero errors either way.

## Running the server without Docker

If you'd rather run the server directly (e.g. on a platform-as-a-service that builds Node
apps for you), skip the Dockerfile/Caddy stack and put your own TLS termination in front
(the platform's load balancer, typically) instead.

1. Set every variable in [Required environment variables](#required-environment-variables)
   below however your host expects (platform env vars, a secret manager, etc).
2. Build:
   ```bash
   npm --workspace=server run build   # tsc -> server/dist
   ```
3. Apply migrations:
   ```bash
   npm --workspace=server run db:deploy   # prisma migrate deploy — safe to run repeatedly, never destructive
   ```
   This only applies migrations already committed under `server/prisma/migrations` — it
   never generates a new one or prompts interactively, which is exactly what you want in a
   deploy pipeline (`prisma migrate dev`, used locally while authoring schema changes, is
   not safe to run unattended).
4. Start it, under a process manager (systemd, pm2) or your platform's own process
   supervisor — **not** directly in a terminal, for the same "survives you logging out"
   reason described in
   [Dev stack vs. production stack](#dev-stack-vs-production-stack--dont-run-one-thinking-its-the-other)
   above:
   ```bash
   node server/dist/index.js
   ```

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
- **`DOMAIN`** (Compose path only) — your server's real hostname. In `PROXY_MODE=local`,
  this is what the bundled Caddy requests a certificate for; in `external`, it's only
  used to label the printed site-block snippet. The one value `npm run deploy` can't
  generate for you — pass it as an argument the first time (`npm run deploy --
  your-domain.com`).
- **`PROXY_MODE`** (Compose path only) — `local` (default) or `external`; see
  [Deploying behind your own reverse proxy](#deploying-behind-your-own-reverse-proxy).
  Set via `--local-proxy`/`--external-proxy` on `npm run deploy`, persisted from then on.
- **`SERVER_PORT`** / **`SERVER_BIND`** (Compose path, `external` mode only) — the host
  port/interface the server is published on for your own proxy to reach. Auto-picked and
  auto-set by `npm run deploy` the first time only — reused as-is on every later redeploy,
  never re-verified (see [What's different from the default (local) mode](#whats-different-from-the-default-local-mode)
  for why); edit it by hand in `.env.prod` if you ever need to change it. See
  [Deploying behind your own reverse proxy](#deploying-behind-your-own-reverse-proxy) for
  the security note on `SERVER_BIND`.
- **`WEB_PORT`** / **`WEB_BIND`** (Compose path, `external` mode only) — same idea as
  `SERVER_PORT`/`SERVER_BIND`, for the web client. Auto-picked *after* `SERVER_PORT` so
  the two never collide, same "first time only" rule otherwise.
- **`CORS_ORIGIN`** (Compose path only) — set automatically to `https://$DOMAIN` by both
  Compose files. See [Security gaps to close before this is public](#security-gaps-to-close-before-this-is-public)
  for what it does and why it's set to your domain rather than left permissive.

## Security gaps to close before this is public

The current code is fine for "one person, their own devices, their own network or a
trusted host" and does **not** currently have:

- **A refresh-token flow** — a "remember me" token (the default; see
  [`api-reference.md`](./api-reference.md#authentication)) never expires, with no
  revocation mechanism short of rotating `JWT_SECRET` (which logs out every device at
  once, not just one). Unchecking "remember me" gets a 1-day token instead, which bounds
  the exposure but still isn't a real revocation story.

`/auth/login` and `/auth/register` **are** rate-limited (10 requests / 15 min per IP,
`@fastify/rate-limit`) and gated behind a self-hosted arithmetic CAPTCHA
(`/auth/captcha`) — enough to blunt generic credential-stuffing/signup-spam bots without
depending on a third-party service (reCAPTCHA/Turnstile). It won't stop a determined,
targeted attacker; nothing here is meant to.

**CORS is now restricted to `CORS_ORIGIN`** (`server/src/index.ts`) instead of reflecting
any request's `Origin`. Both production Compose files set it to `https://$DOMAIN`
automatically — nothing to configure by hand. This only ever gated *browser* requests
from some other origin (the mobile app and any non-browser client never send an `Origin`
header, so they were never affected either way); deploying `web/` on the same domain as
the API (see [Deploying the web client](#deploying-the-web-client)) already makes its own
requests same-origin regardless of this setting. Left unset, the server falls back to
allowing any `http://localhost:<port>`/`http://127.0.0.1:<port>` origin, which is what
lets `web`'s Vite dev server reach the API during local development.

HTTPS termination itself **is** handled by default if you use the Caddy stack above; it's
only a gap if you run the server directly and skip putting anything in front of it (Fastify
itself listens on plain HTTP — a JWT sent over that is trivially interceptable).

None of this matters for local development against `localhost`/your own LAN — it starts
mattering the moment the server is reachable from the open internet.

## Deploying the web client

The web client (`web/`) is a thin, server-dependent React app with no offline story — see
[`architecture.md`](./architecture.md#two-frontend-clients-one-api) for why it's built
that way instead of as a third Expo target. **It deploys automatically, on the same
domain as the API, every time you run `npm run deploy`** — there's no separate step or
flag. `web/dist`'s static build has zero server-side requirements beyond reaching the
API, so if you'd rather host it elsewhere instead (Netlify, Cloudflare Pages, GitHub
Pages, S3+CDN, ...), that works too — nothing below is required, just the option that's
wired up and tested.

**Same domain, path-routed**: the API keeps its fixed, small set of routes (`/health`,
`/auth/*`, `/sync/*` — see `server/src/index.ts`/`server/src/routes/*.ts`) on `$DOMAIN`;
every other path on that same domain serves the web app instead. This is why
`EXPO_PUBLIC_API_URL` (the mobile app) and a browser visiting `$DOMAIN` hit the exact same
host — one domain, one certificate, no second DNS record to manage. See the root
[`Caddyfile`](../Caddyfile) for the bundled version of this routing, or
[What the deploy script prints](#what-the-deploy-script-prints) below for the
external-proxy equivalent.

`PROXY_MODE=local` (the default) needs nothing extra — `npm run deploy -- your-domain.com`
already builds and starts `web` alongside `postgres`/`server`/`caddy`, and the [Quick
start](#quick-start-production-deployment-caddy--docker-compose) verification steps check
both `https://your-domain.com/health` and `https://your-domain.com/`.

`PROXY_MODE=external` additionally auto-picks a `WEB_PORT` (starting at 3002, scanned to
land *after* whatever `SERVER_PORT` ends up being, so the two can never collide) and
prints a combined site-block snippet path-routing both under your domain — see
[Deploying behind your own reverse proxy](#deploying-behind-your-own-reverse-proxy)
above, which now covers the web client too.

### Doing it by hand instead

Equivalent manual command, either mode:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

### Verified locally

Built and ran the full local-mode stack this way against `DOMAIN=localhost` (Caddy's
local self-signed CA, same smoke-test pattern described in [How the stack fits
together](#how-the-stack-fits-together)): all four containers came up, and the *same*
Caddy site block correctly path-routed `/health`, `/auth/login`, and `/sync/pull` to the
server (real JSON validation errors and a 401 came back, not the SPA) while `/` and its
static assets served the web app, with the served bundle's `VITE_API_URL` correctly baked
in to `https://localhost`.

Also specifically reproduced and confirmed the fix for the port-collision bug this
section used to have: held port 3001 open with a throwaway listener to force
`SERVER_PORT`'s scan to move to 3002, then ran the external-proxy deploy — `WEB_PORT`
correctly scanned past the server's port and landed on 3003 instead of also picking 3002,
and both containers were reachable directly on their own ports. Not yet exercised against
a real domain/Let's Encrypt or alongside a real mobile client pointed at the same server.

## Deploying the Expo app

So far, "running the app" has meant Expo Go against `npx expo start` — great for
development, but Expo Go is a dev client: it can't be handed to someone else, doesn't
work offline from your dev machine, and isn't what you'd put on your own phone
permanently. This section is about producing an actual installable app.

Three distinct things, easy to conflate:

1. **Building** — compiling the app into something installable (`.apk`/`.aab` for
   Android, `.ipa` for iOS), via [EAS Build](https://docs.expo.dev/build/introduction/)
   (Expo's cloud build service — nothing to install locally beyond the CLI). **This
   happens automatically as part of `npm run deploy`** (see below) — not a separate
   process you have to remember to run.
2. **Installing it somewhere** — an *internal distribution* build (a direct download
   link, no review) for personal/team use, vs. a full App Store/Play Store release for
   the public. This doc focuses on internal distribution — the right stopping point for
   a personal app.
3. **Updating it afterward** — [OTA updates](./development.md#ota-updates)
   (`npm run deploy:app`, a thin wrapper around `eas update`) for JS/asset-only changes to
   an *already-installed* build, vs. a brand new build (item 1) for anything touching
   native code. This one *is* deliberately a separate, lighter command — it's for the
   common case of shipping a JS fix between full deploys, without waiting on a cloud
   build.

### `npm run deploy` builds the app too

Once [Step 1](#step-1-one-time-setup) below has been done once (logged in, project
linked), every `npm run deploy` run also submits an EAS Build for the mobile app —
alongside the server and web client, as one command, matching this project's [feature
parity policy](../CLAUDE.md). Concretely, after the server/web containers are up and
verified, `scripts/deploy.mjs`:

1. Confirms `app/` and `shared/` have no uncommitted changes (skips the mobile build,
   with a clear warning, rather than shipping unreviewed code — the server/web deploy
   that already happened is unaffected either way).
2. Confirms you're logged in to EAS (`npx eas-cli@latest whoami`) — skips with a warning
   if not, telling you to `cd app && npx eas-cli@latest login` and re-run.
3. Cross-checks `app/eas.json`'s baked `EXPO_PUBLIC_API_URL` against `.env.prod`'s
   `DOMAIN` (same check described in [Step 2](#step-2-point-the-build-at-your-server)
   below) — a mismatch here is exactly the class of bug that shipped earlier in this
   project's history.
4. Submits the build (`eas build --platform android --profile preview` by default) with
   `--no-wait` — it doesn't block the rest of the deploy for the several minutes a cloud
   build takes; EAS prints a dashboard link/QR code once it's done, separately.
   **The very first build ever is the one exception that isn't hands-off**: if `app.json`
   isn't linked to an EAS project yet, `eas build` interactively asks right there in your
   terminal which account/project to use (this is why the deploy script never passes
   `--non-interactive` for this step) — answer it once, and it's written into `app.json`
   (commit that change), after which every future deploy's build goes out unattended
   again with nothing to answer.

Override the platform/profile, or skip it for one run:

```bash
npm run deploy -- your-domain.com --app-platform ios --app-profile production
npm run deploy -- your-domain.com --skip-app   # server + web only, this run
```

### Step 1: One-time setup

`app/eas.json` is already committed (see below for why) — you still need to log in and
link the project to your own EAS account the first time:

```bash
npm i -g eas-cli
cd app
eas login
eas build:configure
```

`eas build:configure` asks a few questions (platforms to support) and links the project to
an EAS project (writing `extra.eas.projectId` into `app.json` — the same field
`eas update:configure` uses for [OTA updates](./development.md#ota-updates), so you only
need to link the project once regardless of which you set up first). If it offers to
overwrite the existing `eas.json`, decline (or re-add the `EXPO_USE_METRO_WORKSPACE_ROOT`
env var below afterward) — that's the monorepo fix described next.

**Monorepo builds need `EXPO_USE_METRO_WORKSPACE_ROOT=1`.** Since this repo is an npm
workspaces monorepo, `node_modules` (including `expo` itself) is hoisted to the repo
root rather than living inside `app/node_modules`. Expo's default entry point
(`expo/AppEntry.js`) resolves your app's root component with a path relative to wherever
`node_modules/expo` physically is — so without this variable, EAS Build fails with
`Unable to resolve module ../../App`, because it's looking two directories above the
*hoisted* `node_modules/expo` (the repo root) instead of `app/`. Each build profile in
`app/eas.json` sets it in its `env` block:
```jsonc
// app/eas.json
{
  "build": {
    "preview": {
      "env": { "EXPO_USE_METRO_WORKSPACE_ROOT": "1" }
    }
    // ...same for development/production
  }
}
```
This only affects EAS's remote build environment — local dev doesn't need it, since
`app/metro.config.js` already sets the equivalent `watchFolders`/`resolver.nodeModulesPaths`
manually for the dev server (see [`architecture.md`](./architecture.md#two-frontend-clients-one-api)).

### Step 2: Point the build at your server

Local dev reads `app/.env` live, every time you start Metro. A build is different: EAS
Build runs on Expo's servers, not your machine, and whatever `EXPO_PUBLIC_*` values were
present *at build time* get compiled directly into the JS bundle — there's no `.env` file
on your machine for it to read, and no way to change it after the fact without a new
build (an OTA update can't change this either, since it's baked into the bundle the OTA
update itself would be diffed against).

The fix: set it in the `app/eas.json` step 1 just created, per build profile, so it's
explicit and versioned rather than depending on whatever happened to be in your shell.
Add an `env` block to whichever profile(s) you'll actually build with:

```jsonc
// app/eas.json
{
  "build": {
    "production": {
      "env": { "EXPO_PUBLIC_API_URL": "https://your-domain.com" }
    },
    "preview": {
      "env": { "EXPO_PUBLIC_API_URL": "https://your-domain.com" }
    }
  }
}
```

This is a plain URL, not a secret, so committing it in `eas.json` is fine — unlike
`JWT_SECRET`/`POSTGRES_PASSWORD`, there's nothing here worth hiding. (If you ever *do*
need to bake in a real secret for some other variable, use [EAS's environment
variables](https://docs.expo.dev/eas/environment-variables/) — `eas env:create` — instead
of putting it in `eas.json`.)

### Step 3: Build

Building itself is [automated as part of `npm run deploy`](#npm-run-deploy-builds-the-app-too)
— once Steps 1-2 are done, you generally don't run `eas build` by hand at all. Spelled out
manually anyway (useful the very first time, or to build a platform/profile combination
`npm run deploy` isn't currently configured for):

```bash
eas build --platform android --profile preview
```

Use the `preview` profile (`"distribution": "internal"` by default from
`build:configure`) for this — `production` is meant for an actual store submission (see
[Going further](#going-further-an-actual-app-store--play-store-release) below) and may be
configured for that instead (e.g. an `.aab` for Play Store rather than an installable
`.apk`).

You'll likely see this warning — it's informational, not a failure, and safe to ignore
for a personal internal-distribution build (set `EAS_BUILD_NO_EXPO_GO_WARNING=true` to
silence it if it bothers you):
```
⚠️ Detected that your app uses Expo Go for development, this is not recommended when building production apps.
```

**iOS only:** you also need an [Apple Developer Program](https://developer.apple.com/programs/)
membership ($99/year) before EAS can produce anything installable on a real device —
there's no way around this, it's an Apple platform requirement, not an Expo one — and you
need to register the specific device(s) you want to install on, *before* building:

```bash
eas device:create   # follow the prompt; registers a device's UDID with Apple
eas build --platform ios --profile preview
```

EAS handles provisioning-profile/certificate creation for you interactively the first
time — this is also why `npm run deploy`'s automated build defaults to `android`, which
doesn't need this interactive step; pass `--app-platform ios` once device
registration/certificates are already sorted out.

### Step 4: Install it

- **Android**: no developer account needed for internal distribution. The build finishes
  with a download link — open it on the phone (or scan the QR code EAS prints) and
  install directly. Android will warn about installing from an unknown source the first
  time; that's expected for a non-Play-Store install.
- **iOS**: installs via TestFlight or a direct install link, depending on the profile's
  `distribution` setting.

### Step 5: Keeping it updated

- **JS/asset-only change** (a new screen, a bug fix, anything not touching native
  dependencies or `app.json`'s native-affecting config): ship it as an
  [OTA update](./development.md#ota-updates) — `npm run deploy:app` — no new build, no
  reinstalling anything. This is the one piece that's *intentionally* a separate, lighter
  command from `npm run deploy` — see `scripts/deploy-app.mjs`.
- **Native change** (a new native dependency, an Expo SDK upgrade, a change to
  permissions/icons/etc. in `app.json`): just run `npm run deploy` again — it rebuilds the
  app as part of the same command, no separate step needed.

### Going further: an actual App Store / Play Store release

Out of scope for a personal app, but if you want it later: `eas submit` uploads a
`production`-profile build to App Store Connect / Google Play, after which normal store
review/listing requirements apply (screenshots, a privacy policy, Apple/Google developer
account enrollment if not already done for the steps above). Start with [Expo's own
submission guide](https://docs.expo.dev/submit/introduction/) when you get there — nothing
in this repo needs to change to support it, it's purely an EAS/store-side process.
