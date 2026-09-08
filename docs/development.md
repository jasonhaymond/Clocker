# Development Guide

## Prerequisites

- Node.js 20+ (the repo was built/tested on 24.x)
- Docker Desktop (for local Postgres) — optional if you point `DATABASE_URL` at your own
  Postgres instance instead
- Expo Go on a phone, and/or Xcode/Android Studio for a simulator, to run the app

## First run

```bash
npm run setup
```

This is `scripts/setup.mjs`. It, in order:

1. `npm install` at the repo root (an npm workspaces monorepo — this installs both
   `app/` and `server/`'s dependencies in one pass; there's no separate install step per
   workspace)
2. creates `server/.env` from `server/.env.example` if it doesn't exist yet, with
   `JWT_SECRET` replaced by a freshly generated 96-character random hex string
   (`crypto.randomBytes(48)`) — if `server/.env` already exists it's left untouched
3. runs `docker compose up -d` (skipped with a warning if Docker isn't installed), then
   polls `pg_isready` for up to 30s
4. runs `prisma migrate deploy` and `prisma generate` against that database

Every step is idempotent — re-running `npm run setup` on an already-set-up machine just
confirms everything's in place and exits cleanly.

## Staying up to date

```bash
npm run update
```

`scripts/update.mjs`: `git pull --ff-only` (skipped entirely, with instructions, if your
working tree has uncommitted changes — it will never pull over local edits), then
`npm install`, then re-applies migrations the same way `setup` does. Use this instead of
`git pull` by hand when you want dependency and migration drift handled for you.

Both scripts are plain Node (`scripts/lib.mjs` has the shared `run`/`step`/`warn`/`fail`
helpers) — no extra dependency needed to run them, and they degrade gracefully rather than
crash with a stack trace: a failed non-critical step (e.g. Prisma client generation — see
[Known issue: Prisma + Windows](#known-issue-prisma-client-generation-on-windows) below)
prints a `!` warning and continues instead of aborting the whole script.

## Running things day to day

```bash
npm run dev:server   # tsx watch — restarts on save, http://localhost:3001
npm run dev:app      # expo start — press i/a/w, or scan the QR code with Expo Go
```

Other useful commands, run from the repo root:

| Command | What it does |
|---|---|
| `npm run db:migrate` | `prisma migrate dev` — create + apply a new migration after editing `schema.prisma` (interactive; asks to name it) |
| `npm run db:generate` | Regenerate the Prisma client after schema/model changes |
| `npm --workspace=server run db:studio` | Opens Prisma Studio, a GUI for browsing/editing the Postgres data |
| `npm --workspace=server run build` | Typechecks and compiles the server to `server/dist` |
| `npx tsc --noEmit -p tsconfig.json` (from `app/` or `server/`) | Typecheck only, no build output |
| `docker compose up -d` / `down` | Start/stop the local Postgres container |

There's no automated test suite yet — verification today is `tsc --noEmit` on both
workspaces plus manual exercise of the app (see the curl sequence in
[`api-reference.md`](./api-reference.md#manual-smoke-test) for the server side).

## Environment variables

`server/.env` (see `server/.env.example`):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. Local default points at the Docker Compose Postgres on port `5433` (see [below](#why-non-default-ports)). |
| `JWT_SECRET` | Signs auth tokens. `npm run setup` generates one for you locally; **must** be set to a real secret before any non-local deployment (see [`deployment.md`](./deployment.md)). |
| `PORT` | Fastify's listen port, default `3001`. |

The app reads one variable, set however you launch Expo (shell env var, or an `.env` file
if you add `react-native-dotenv`/similar — not currently wired up):

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_API_URL` | Base URL the app calls for auth/sync. Defaults to `http://localhost:3001` (`app/src/sync/api.ts`). Android emulator: `http://10.0.2.2:3001`. Physical device: your machine's LAN IP. |

## Why non-default ports

This machine already runs other local projects on the usual ports, so Clocker's
`docker-compose.yml` maps Postgres to host port **5433** (container-internal 5432 is
unaffected) and the server defaults to port **3001**. If you're setting this up somewhere
those ports are free, feel free to change both back to their defaults in
`docker-compose.yml` / `server/.env` / `app/src/sync/api.ts` — nothing else depends on
the specific numbers.

## Known issue: `@types/react` version pin

`app/package.json` pins `@types/react` to the **exact** version `19.2.2`, not a range.
Every patch release above that (tested through `19.2.18`) breaks TypeScript's checking of
every React Native core component (`View`, `Text`, `TextInput`, ...) with errors like:

```
error TS2786: 'View' cannot be used as a JSX component.
  Type 'typeof View' is not assignable to type 'new (props: any, context: any) => Component<any, any, any>'.
```

This reproduces even in a completely untouched `npx create-expo-app@latest` output, so
it's an upstream regression, not anything specific to this codebase. If you ever bump this
dependency, run `npx tsc --noEmit -p app/tsconfig.json` before trusting the new version —
if the errors above come back, roll back to a version confirmed clean the same way.

## Known issue: Prisma client generation on Windows

`prisma generate` occasionally fails on Windows with:

```
EPERM: operation not permitted, rename '...\.prisma\client\query_engine-windows.dll.node.tmp...' -> '...\query_engine-windows.dll.node'
```

This is a file lock on the query engine binary from another running process (a lingering
`tsx watch`, an editor's TypeScript server, antivirus scanning) — not a broken schema.
`scripts/setup.mjs` and `scripts/update.mjs` treat this step as non-fatal for exactly this
reason. If it happens, close anything that might be holding the file (stop `npm run
dev:server`, restart your editor's TS server) and re-run `npm run db:generate
--workspace=server`.

## OTA updates

`expo-updates` is installed and the app checks for updates on launch/foreground (see
`app/src/updates`), but publishing an update requires linking the app to an EAS project —
a one-time step tied to your own Expo account, so it isn't automated by `npm run setup`:

```bash
npm i -g eas-cli
cd app
eas login
eas update:configure   # writes extra.eas.projectId + updates.url into app.json
```

After that, ship a JS-only change (no native module changes) without an app-store release:

```bash
cd app
eas update --branch production --message "Describe the change"
```

Until `eas update:configure` has been run, the Settings screen's update section always
reads "Updates aren't available in this build" — this is expected in Expo Go and any local
dev build, not a bug.
