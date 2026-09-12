# Development Guide

## Prerequisites

- [ ] Node.js 20+ installed (the repo was built/tested on 24.x) — `node --version`
- [ ] Docker Desktop installed and running — `docker --version` (optional; skip if you'll
      point `DATABASE_URL` at your own Postgres instance instead)
- [ ] Expo Go installed on a phone, and/or Xcode/Android Studio for a simulator, to
      actually run the app — **except for the persistent "clocked in" Android notification**
      (`react-native-notify-kit`, a native module): that one feature needs a custom
      dev/production build (`eas build --profile development` or `preview`/`production`),
      not Expo Go. Everything else in the app still works fine in Expo Go.

## First run

1. Clone the repo and `cd` into it, if you haven't already:
   ```bash
   git clone https://github.com/<you>/Clocker.git
   cd Clocker
   ```
2. Run the setup script:
   ```bash
   npm run setup
   ```
3. Confirm it finished cleanly — the last line should say something like "Setup complete."
   with no `✗`/error lines above it. If a step warned (`!`) rather than failed, that's
   expected for some non-critical steps (see the Known Issues below) and setup still
   succeeded.

`npm run setup` is `scripts/setup.mjs`. What it does, in order, so you know what to expect
(and what to check if a step fails):

1. `npm install` at the repo root (an npm workspaces monorepo — this installs both
   `app/` and `server/`'s dependencies in one pass; there's no separate install step per
   workspace).
2. Picks a port for Postgres and one for the API — reusing whatever's already configured
   in `server/.env` if it's still actually free, otherwise scanning upward from 5433/3001
   for the first one that is — see [Automatic port selection](#automatic-port-selection).
   Writes/updates `server/.env` with those ports, generating a 96-character random hex
   `JWT_SECRET` (`crypto.randomBytes(48)`) the first time only — an existing secret is
   never touched.
3. Runs `docker compose up -d` (skipped with a warning if Docker isn't installed), then
   polls `pg_isready` for up to 30s.
4. Runs `prisma migrate deploy` and `prisma generate` against that database.

Every step is idempotent — re-running `npm run setup` on an already-set-up machine just
confirms everything's in place and exits cleanly. Run it again any time something seems
off before troubleshooting further; it's the reset-to-known-good command.

## Staying up to date

1. Make sure your working tree is clean (`git status`) — commit or stash anything
   in-progress first. `npm run update` refuses to pull over uncommitted changes rather
   than risk overwriting them, so this step avoids it stopping partway through.
2. ```bash
   npm run update
   ```

`scripts/update.mjs`: `git pull --ff-only` (skipped entirely, with instructions, if your
working tree has uncommitted changes), then `npm install`, then re-applies migrations the
same way `setup` does. Use this instead of `git pull` by hand when you want dependency and
migration drift handled for you.

Both scripts are plain Node (`scripts/lib.mjs` has the shared `run`/`step`/`warn`/`fail`
helpers) — no extra dependency needed to run them, and they degrade gracefully rather than
crash with a stack trace: a failed non-critical step (e.g. Prisma client generation — see
[Known issue: Prisma + Windows](#known-issue-prisma-client-generation-on-windows) below)
prints a `!` warning and continues instead of aborting the whole script.

## Running things day to day

1. Start the server (leave this running in its own terminal):
   ```bash
   npm run dev:server   # tsx watch — restarts on save; prints the actual port on startup
   ```
2. In a second terminal, start whichever client(s) you're working on:
   ```bash
   npm run dev:app      # expo start — press i/a, or scan the QR code with Expo Go
   ```
   ```bash
   npm run dev:web      # vite — prints a localhost URL to open in a browser
   ```
3. Confirm the client can reach the server — see [Environment variables](#environment-variables)
   below (`EXPO_PUBLIC_API_URL` / `VITE_API_URL`) if it can't.

`dev:server`'s port is whatever `npm run setup` picked (see
[Automatic port selection](#automatic-port-selection)) — check `server/.env`'s `PORT`, or
just read it from the "Server listening at" line the command prints.

Running `dev:app` on a different machine than your phone (e.g. a remote dev box)? Use
`npm run start:tunnel` (from `app/`) instead of step 2's mobile command — see
[Running the dev server from a remote machine](#running-the-dev-server-from-a-remote-machine).
`dev:web` doesn't have an equivalent concern — it's just a browser hitting a URL.

Other useful commands, run from the repo root:

| Command | What it does |
|---|---|
| `npm run db:migrate` | `prisma migrate dev` — create + apply a new migration after editing `schema.prisma` (interactive; asks to name it) |
| `npm run db:generate` | Regenerate the Prisma client after schema/model changes |
| `npm --workspace=server run db:studio` | Opens Prisma Studio, a GUI for browsing/editing the Postgres data |
| `npm --workspace=server run build` | Typechecks and compiles the server to `server/dist` |
| `npm --workspace=web run build` | Typechecks and produces a static production build in `web/dist` |
| `npx tsc --noEmit -p tsconfig.json` (from `app/`, `server/`, `shared/`, or `web/`) | Typecheck only, no build output |
| `docker compose up -d` / `down` | Start/stop the local Postgres container |

There's no automated test suite yet — verification today is `tsc --noEmit` on both
workspaces plus manual exercise of the app (see the curl sequence in
[`api-reference.md`](./api-reference.md#manual-smoke-test) for the server side).

## Environment variables

`server/.env` (see `server/.env.example`), values generated by `npm run setup` unless
noted:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string, pointed at whatever port `setup` chose (see [Automatic port selection](#automatic-port-selection)). |
| `JWT_SECRET` | Signs auth tokens. `npm run setup` generates one for you locally; **must** be set to a real secret before any non-local deployment (see [`deployment.md`](./deployment.md)). |
| `PORT` | Fastify's listen port — also chosen by `setup`, not a fixed default. |

Root `.env` (separate file, read by Docker Compose only — not the app or the server):

| Variable | Purpose |
|---|---|
| `POSTGRES_PORT` | The host port `docker-compose.yml` publishes Postgres on. Set by `npm run setup` to match `server/.env`'s `DATABASE_URL`; only relevant if you run `docker compose up` directly. |

`app/.env` (copy from `app/.env.example`) — Expo loads this automatically for both
`npx expo start` and EAS builds via its built-in `@expo/env` support, no extra
config/package needed; any `EXPO_PUBLIC_`-prefixed variable gets inlined into the app
bundle. This is the persistent way to point the app somewhere other than
`localhost:3001`; setting the same variable inline per-command (`EXPO_PUBLIC_API_URL=...
npm run start`) works too and overrides the `.env` file for that one run.

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_API_URL` | Base URL the app calls for auth/sync. Defaults to `http://localhost:3001` (`app/src/sync/api.ts`) if `app/.env` doesn't exist and none is set inline — override with whatever port `server/.env`'s `PORT` actually is for local dev, or a deployed server's URL (see [`deployment.md`](./deployment.md)). Android emulator: `http://10.0.2.2:<port>`. Physical device: your machine's LAN IP. |

`web/.env` (copy from `web/.env.example`) — Vite's equivalent: any `VITE_`-prefixed
variable gets inlined into the browser bundle, loaded automatically by `npm run dev:web`
and `npm run build --workspace=web`.

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Base URL the web client calls for auth/sync. Defaults to `http://localhost:3001` (`web/src/api.ts`) if `web/.env` doesn't exist. Same value as `EXPO_PUBLIC_API_URL` above for local dev; no Android-emulator/LAN-IP concerns since it runs in a regular browser. |

## Automatic port selection

`npm run setup` never assumes the conventional `5433` (Postgres) or `3001` (API) are
actually free — plenty of dev machines run several projects at once, and a hard-coded
port is a recurring source of "why won't this start" (this project ran into exactly that
with another local project already on `3000`/`5432`). Every time you run `setup` —
first time or the hundredth — `scripts/setup.mjs`:

1. Reads whatever port is currently configured (`server/.env`'s `PORT`/`DATABASE_URL`, or
   nothing on a fresh clone).
2. **Actually checks whether that port is available right now** (a real socket bind via
   `isPortFree` in `scripts/lib.mjs`) — not just "did we pick this before."
3. If it's free (or, for Postgres, if *this project's own* container is what's currently
   holding it — starting it back up is the point, not a conflict), keeps it.
4. Otherwise, scans upward from the conventional starting point (`findFreePort`) for the
   first genuinely free port, prints a message explaining why it changed, and writes the
   new value.

This means a port that was free when you first ran `setup` but has since been claimed by
some other app gets automatically replaced on your next `setup` run, rather than silently
failing to start — this was a real gap in an earlier version of this script, which only
ever scanned on a completely fresh install and otherwise trusted whatever was already in
`server/.env` forever.

Two implementation details worth knowing:

- **The Postgres port is mirrored into a root `.env`** (distinct from `server/.env`)
  purely so `docker-compose.yml`'s `${POSTGRES_PORT:-5433}` picks it up — Compose
  auto-loads a `.env` file from the project directory. `setup` keeps the two files in
  sync every run.
- **Re-verifying never disrupts an already-running dev server.** If you have
  `npm run dev:server` open in another terminal, re-running `setup` won't touch that
  running process — at most it updates `server/.env` for the *next* time you start it. If
  its port really has been taken over by something else, you'd see that as a normal
  `EADDRINUSE` the next time you restart it, at which point `setup`'s new value is
  already waiting.

### Changing a port

There's no dedicated flag for this — edit the file and let `setup` pick up and persist
your choice. If you're setting this up somewhere the conventional ports are free, skip
this entirely — `3001`/`5433` are just what gets picked and nothing here applies to you.

**To change the API port:**

1. Edit `PORT` in `server/.env` to the port you want.
2. Run `npm run setup` again.

`setup` checks that port is actually free (not just "different from before") and, if so,
keeps your exact choice from then on — every future `setup` run reuses it rather than
picking a new one, as long as it stays free. If the port you asked for turns out to be
taken, `setup` tells you so and picks a different one instead of silently ignoring your
edit.

**To change the Postgres port:**

1. Edit `POSTGRES_PORT` in the root `.env` (not `server/.env`'s `DATABASE_URL` directly —
   `setup` treats the root `.env` as the source of truth for this one and will overwrite a
   `DATABASE_URL` port that disagrees with it).
2. If Postgres is currently running, stop it first so the new port actually takes effect:
   ```bash
   docker compose down
   ```
3. Run `npm run setup` again.

## Known issue: `@types/react` version pin

`app/package.json` pins `@types/react` to the **exact** version `19.2.2`, not a range.
Every patch release above that (tested through `19.2.18`) breaks TypeScript's checking of
every React Native core component (`View`, `Text`, `TextInput`, ...) with errors like:

```
error TS2786: 'View' cannot be used as a JSX component.
  Type 'typeof View' is not assignable to type 'new (props: any, context: any) => Component<any, any, any>'.
```

This reproduces even in a completely untouched `npx create-expo-app@latest` output, so
it's an upstream regression, not anything specific to this codebase.

**If you ever bump this dependency:**

1. ```bash
   cd app && npx tsc --noEmit -p tsconfig.json
   ```
2. If the errors above come back, roll back to a version confirmed clean the same way
   (re-run step 1 after rolling back to verify).

## Known issue: Prisma client generation on Windows

`prisma generate` occasionally fails on Windows with:

```
EPERM: operation not permitted, rename '...\.prisma\client\query_engine-windows.dll.node.tmp...' -> '...\query_engine-windows.dll.node'
```

This is a file lock on the query engine binary from another running process (a lingering
`tsx watch`, an editor's TypeScript server, antivirus scanning) — not a broken schema.
`scripts/setup.mjs` and `scripts/update.mjs` treat this step as non-fatal for exactly this
reason.

**If it happens:**

1. Close anything that might be holding the file — stop `npm run dev:server`, restart
   your editor's TypeScript server.
2. Re-run generation:
   ```bash
   npm run db:generate --workspace=server
   ```

## Web client (`web/`)

Web is a separate, thin client (Vite + React), not a third Expo target — see
[`architecture.md`](./architecture.md#two-frontend-clients-one-api) for why. It has no
local database and no offline story: every action calls the server directly. Per
[`../CLAUDE.md`](../CLAUDE.md), it carries the same feature set as the mobile app — Jobs
(rate tiers, overtime, rounding, timesheet settings), Clock (multi-job, breaks, "At...",
notes), History (multi-select delete), Timesheets, Export, and Managers — adapted to what
a browser can actually do (a download + clipboard copy where mobile has a native share
sheet/mail composer; no OTA-update concept, since a page reload always serves the latest
deploy). `web/src/store.tsx` is the single place every screen reads/writes through — each
mutation there pushes one change and re-pulls, the same pattern as `app/src/db/database.ts`
minus the local SQLite/outbox layer.

1. Copy the env template and point it at your server:
   ```bash
   cd web
   cp .env.example .env
   ```
   Edit `.env`'s `VITE_API_URL` if your server isn't on `localhost:3001` — see
   [Automatic port selection](#automatic-port-selection) for what port `setup` actually
   picked.
2. Start it (from the repo root, in its own terminal — alongside `npm run dev:server`
   from [Running things day to day](#running-things-day-to-day) above):
   ```bash
   npm run dev:web
   ```
3. Open the URL Vite prints (`http://localhost:5173` by default) in a browser and
   register an account — it's a separate `User` row from anything you've created in the
   mobile app or Expo Go, same as signing up on a second device.

Other useful commands, run from `web/`:

| Command | What it does |
|---|---|
| `npm run build` | Typechecks, then produces a static production build in `web/dist` |
| `npm run preview` | Serves that production build locally, to sanity-check it before deploying |
| `npm run typecheck` | Typecheck only, no build output |

Verified end to end against a real running server: every mutation `web/src/store.tsx`
sends (job creation with rate tiers, clock in/out, breaks, shift notes, manager creation
and assignment, overtime/rounding/timesheet-settings updates, deletes) was replayed
directly against `/sync/push`/`/sync/pull` and round-tripped correctly, on top of a clean
typecheck and production build. Not yet exercised by hand in an actual browser — do a
quick pass there per this project's manual-verification standard before trusting it
blindly, the same as any other UI-facing change.

Known adaptations from the mobile app, not gaps — see `CLAUDE.md`'s feature-parity
policy for why these differ in mechanism but not in what you can do: CSV export and
Timesheet submission download a file and copy formatted text to the clipboard instead of
using a native share sheet/mail composer (`web/src/lib/download.ts`), and there's no
OTA-update concept (a page reload always serves the latest deploy).

## Known issue: React Native DevTools error on a headless Linux box

Running `npm run dev:app` on a Linux machine with no display server (a remote/SSH-only
box, exactly the kind of machine you might use for a persistent dev setup) can log this
on startup or when pressing `j` (open debugger):

```
ERROR  An unknown error occurred while installing React Native DevTools. Details:
.../@react-native/debugger-shell/bin/react-native-devtools: error while loading shared
libraries: libatk-1.0.so.0: cannot open shared object file: No such file or directory
```

This is the new React Native DevTools trying to launch its bundled native (GTK/Chromium)
debugger window — unrelated to Metro serving the JS bundle to Expo Go, which keeps
working fine regardless. It's safe to ignore. Installing the missing library
(`sudo apt-get install libatk1.0-0 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libasound2` on
Debian/Ubuntu) silences the specific error, but a debugger *window* fundamentally can't
open on a machine with no display server at all — so there's nothing to actually fix
here beyond not pressing `j` in that terminal.

## Running the dev server from a remote machine

If `app/`'s dev server (`npm run dev:app`) runs on a different machine than your phone —
a persistent remote/SSH box rather than your own laptop, the same setup as the DevTools
issue above — Expo Go can end up just spinning and never loading the app. That's Expo's
default "LAN" connection mode: it advertises the *server's* local IP in the QR code, which
your phone can't route to unless it's genuinely on the same network.

**Fix:**

1. ```bash
   cd app
   npm run start:tunnel   # or: npx expo start --tunnel
   ```
2. Scan the new QR code — it's a different URL than plain `npm run dev:app` printed, so
   scanning an old/cached QR code from a previous run won't work.

Tunnel mode relays through Expo's own infrastructure instead, so it works regardless of
which networks the server and your phone are each on (at the cost of a bit of latency).
It needs `@expo/ngrok`, already in `app/`'s `devDependencies` for exactly this reason —
Expo would otherwise offer to install it *globally* on first use, which fails with a
permissions error on plenty of Linux setups (Node installed via a system package manager
rather than something like `nvm`, so the global `node_modules` isn't user-writable).
Having it locally means `npm install` is all that's ever needed; nothing to install
globally or `sudo`.

If your phone genuinely *is* on the same LAN as the server and it's still not loading,
that's more likely a firewall blocking Metro's port (8081) than a connection-mode issue.

## OTA updates

`expo-updates` is installed and the app checks for updates on launch/foreground (see
`app/src/updates`), but publishing an update requires linking the app to an EAS project —
a one-time step tied to your own Expo account, so it isn't automated by `npm run setup`.

### One-time setup

1. ```bash
   npm i -g eas-cli
   cd app
   eas login
   ```
2. ```bash
   eas update:configure   # writes extra.eas.projectId + updates.url into app.json
   ```

Until this has been run, the Settings screen's update section always reads "Updates
aren't available in this build" — this is expected in Expo Go and any local dev build, not
a bug.

### Shipping an update

Whenever you want to ship a JS-only change (no native module changes) without an
app-store release:

```bash
npm run deploy:app
```

`scripts/deploy-app.mjs` — refuses to run over uncommitted changes in `app/`/`shared/`,
confirms you're logged in to EAS, cross-checks `app/eas.json`'s baked
`EXPO_PUBLIC_API_URL` against `.env.prod`'s `DOMAIN`, then runs `eas update --branch
production` with a message derived from your latest commit (or pass `-- --message "..."`
for a custom one). This is deliberately a separate, lighter command from `npm run
deploy` — that one rebuilds the whole app for native changes; this one is JS-only and
doesn't touch a cloud build at all.

This covers *updating* an already-installed build. For producing that build in the first
place — EAS Build, internal distribution, installing on a real device — see
[Deploying the Expo app](./deployment.md#deploying-the-expo-app).
