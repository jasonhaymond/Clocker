# Clocker

A personal timeclock app for tracking hours across multiple jobs — clock in/out, breaks,
history, and CSV export. Built as an offline-first React Native (Expo) app backed by a
small Fastify + PostgreSQL server for cross-device sync.

## How it works

- **App** (`app/`): Expo + React Native + TypeScript. All data lives first in a local
  SQLite database (`app/src/db`), so the app works fully offline. Every local write is
  also recorded in a `pending_changes` outbox table.
- **Server** (`server/`): Fastify + Prisma + PostgreSQL. Exposes email/password auth and
  two sync endpoints (`/sync/push`, `/sync/pull`) that the app calls opportunistically
  (on launch, every 5 minutes, on app foreground, and after local edits).
- **Sync** (`app/src/sync/sync.ts`): push whatever's in the outbox, then pull anything
  newer than the last-seen server timestamp and merge it into the local mirror. Conflicts
  resolve last-write-wins by `updatedAt`.

For the full picture — why it's built this way, the exact data model on both sides, the
complete sync protocol, and the full HTTP API — see **[`docs/`](./docs/README.md)**:

| | |
|---|---|
| [Architecture](./docs/architecture.md) | Design principles and the reasoning behind them |
| [Data Model](./docs/data-model.md) | Every table/field, Postgres and SQLite |
| [Sync Protocol](./docs/sync-protocol.md) | The outbox, conflict resolution, ownership checks |
| [API Reference](./docs/api-reference.md) | Every endpoint, with a curl smoke test |
| [Development Guide](./docs/development.md) | Setup/update scripts, env vars, known issues |
| [Deployment](./docs/deployment.md) | Default Caddy + Docker Compose stack, env vars, security gaps to close |

## Project layout

```
app/       Expo app (screens, local DB, sync client, auth)
server/    Fastify API + Prisma schema/migrations, Dockerfile
scripts/   setup.mjs / update.mjs — dev environment bootstrap and update
docs/      Detailed documentation (see table above)
docker-compose.yml        Local Postgres for development
docker-compose.prod.yml   Postgres + server + Caddy for production (see docs/deployment.md)
Caddyfile                 Reverse proxy config for the production stack
```

## Getting started

### First-time setup

```bash
npm run setup
```

This installs dependencies for both workspaces, picks free ports for Postgres and the API
(see [Automatic port selection](./docs/development.md#automatic-port-selection) — it
re-checks on every run, so a port that's since been claimed by something else gets
replaced automatically rather than silently failing to start), creates/updates
`server/.env` with a freshly generated `JWT_SECRET` the first time only, starts Postgres
via Docker, and applies migrations. Safe to re-run any time. If Docker isn't available it
skips starting Postgres and tells you what to do instead (point `DATABASE_URL` in
`server/.env` at your own instance).

### Staying up to date

```bash
npm run update
```

Pulls the latest commits (only if your working tree is clean — otherwise it tells you to
commit or stash first and stops, rather than risk overwriting anything), reinstalls
dependencies, and applies any new migrations.

### Running it

```bash
npm run dev:server   # starts the API — prints the actual port, e.g. "Server listening at http://127.0.0.1:3001"
npm run dev:app      # starts Expo — press i/a, or scan the QR code with Expo Go
```

`npm run setup` picks the server's port automatically (starting at 3001, but scanning
upward if that's already taken by something else on your machine — see
[Automatic port selection](./docs/development.md#automatic-port-selection)), so check
`server/.env`'s `PORT` or the terminal output above rather than assuming 3001.

The app needs to know where your server is, via `EXPO_PUBLIC_API_URL` (defaults to
`http://localhost:3001` — override it if yours landed on a different port). Android
emulator can't reach `localhost` directly — use `10.0.2.2`; a physical device needs your
machine's LAN IP:

```bash
cd app && EXPO_PUBLIC_API_URL=http://192.168.1.20:3001 npm run start
```

### Over-the-air app updates

The app checks for OTA updates (via `expo-updates`) on launch and when it comes back to
the foreground, and the Settings screen shows the current version, lets you check
manually, and prompts to restart once an update has downloaded. This only does anything
in a build published through EAS Update — Expo Go and local dev builds always show
"Updates aren't available in this build."

One-time setup (needs a free Expo account):

```bash
npm i -g eas-cli
cd app
eas login
eas update:configure   # links this app to an EAS project and fills in app.json
```

Then, whenever you want to ship a JS-only change (no native code changes) without an app
store release:

```bash
cd app
eas update --branch production --message "Describe the change"
```

## Features

- Multiple jobs, each with a name, color, and one or more named pay rates ("Standard",
  "Holiday", ...) — see [rate history, tiers, and overtime](./docs/data-model.md#rate-history-tiers-and-overtime)
- Rate changes are versioned: editing a job's rate today never changes what a past shift
  is calculated to have paid
- Optional per-job weekly overtime (a threshold + multiplier), applied automatically when
  calculating pay
- Clock in / clock out, with a live-updating elapsed timer; a rate-tier picker appears
  automatically only for jobs that actually have more than one tier
- Breaks (start/end), excluded from worked-hours totals
- Per-shift notes/comments, added or edited from the History screen
- History grouped by day, with per-day and per-shift totals and computed pay
- CSV export by date range (this week / last week / this month / last 90 days) and job,
  shared via the OS share sheet (iOS/Android)
- Export as a clean, formatted HTML email draft (recipients, subject, and
  earnings/comments/times toggles), opened in your device's mail app for you to review
  and send — see `app/src/lib/exportFormat.ts`
- Offline-first: every action works with no network; a manual "Sync Now" plus automatic
  background sync push changes and pull updates from other devices
- Over-the-air JS updates via `expo-updates` (once `eas update:configure` is run once),
  with a Settings screen banner/button to check for and apply them

## Notes for future work

- Editing a shift's clock-in/clock-out time from the History screen isn't wired up yet
  (delete + re-create is the current workaround; notes/comments are editable, though).
- Export is iOS/Android only for now (`expo-sharing`/`expo-mail-composer` have no web
  support), and HTML email formatting is "not working perfectly on Android" per
  `expo-mail-composer`'s own docs — richest on iOS Mail and most desktop clients.
- Overtime is calculated only over the shifts in whatever date range you export — pass a
  full calendar week (e.g. "This Week") for an exactly correct weekly overtime total.
- The JWT has a 180-day expiry and there's no refresh flow — fine for a personal app,
  worth revisiting if this ever gets multi-user.
