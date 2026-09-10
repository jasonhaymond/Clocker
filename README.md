# Clocker

A personal timeclock app for tracking hours across multiple jobs — clock in/out, breaks,
history, and CSV export. Built as an offline-first React Native (Expo) mobile app, plus a
thin web client, both backed by a small Fastify + PostgreSQL server.

## How it works

- **Mobile app** (`app/`): Expo + React Native + TypeScript. All data lives first in a
  local SQLite database (`app/src/db`), so the app works fully offline. Every local write
  is also recorded in a `pending_changes` outbox table.
- **Web client** (`web/`): Vite + React + TypeScript. No local database — a thin client
  that calls the server directly on every action. Deliberately *not* offline-first; see
  [Architecture](./docs/architecture.md#two-frontend-clients-one-api) for why the two
  clients differ this much.
- **Shared** (`shared/`): framework-free TypeScript (types + pay/rounding/period/export
  calculations) imported by both clients, so they agree on every number.
- **Server** (`server/`): Fastify + Prisma + PostgreSQL. Exposes email/password auth and
  two sync endpoints (`/sync/push`, `/sync/pull`) that both clients call — the mobile app
  opportunistically (on launch, every 5 minutes, on app foreground, and after local
  edits), the web client immediately on every mutation.
- **Sync** (`app/src/sync/sync.ts`, mobile only): push whatever's in the outbox, then pull
  anything newer than the last-seen server timestamp and merge it into the local mirror.
  Conflicts resolve last-write-wins by `updatedAt`.

For the full picture — why it's built this way, the exact data model on both sides, the
complete sync protocol, and the full HTTP API — see **[`docs/`](./docs/README.md)**:

| | |
|---|---|
| [Architecture](./docs/architecture.md) | Design principles and the reasoning behind them, including why there are two separate frontend clients |
| [Data Model](./docs/data-model.md) | Every table/field, Postgres and SQLite |
| [Sync Protocol](./docs/sync-protocol.md) | The outbox, conflict resolution, ownership checks |
| [API Reference](./docs/api-reference.md) | Every endpoint, with a curl smoke test |
| [Development Guide](./docs/development.md) | Setup/update scripts, env vars, known issues |
| [Deployment](./docs/deployment.md) | Server setup (Caddy + Docker Compose, or your own reverse proxy), deploying the web client, building/installing the Expo app, troubleshooting |

## Project layout

```
app/       Expo mobile app (screens, local DB, sync client, auth)
web/       Vite web client (thin, no local DB) — see docs/architecture.md
shared/    Framework-free TypeScript shared by both clients (types + calculations)
server/    Fastify API + Prisma schema/migrations, Dockerfile
scripts/   setup.mjs / update.mjs (dev) and deploy.mjs (production) — see docs/
docs/      Detailed documentation (see table above)
docker-compose.yml        Local Postgres for development
docker-compose.prod.yml   Postgres + server + Caddy (+ optional web) for production (see docs/deployment.md)
Caddyfile                 Reverse proxy config for the production stack
```

## Getting started

Full detail, troubleshooting, and every env var: [Development Guide](./docs/development.md).
This section is the fast path.

### Step 1: Prerequisites

- [ ] Node.js 20+ installed (`node --version`)
- [ ] Docker Desktop installed and running (`docker --version`) — optional; skip if
      you'll point `DATABASE_URL` at your own Postgres instance instead
- [ ] Expo Go installed on a phone, and/or Xcode/Android Studio for a simulator

### Step 2: Clone and run first-time setup

```bash
git clone https://github.com/<you>/Clocker.git
cd Clocker
npm run setup
```

`npm run setup` (`scripts/setup.mjs`) does everything needed to go from a fresh clone to a
runnable app, and is safe to re-run any time:

1. `npm install` at the repo root — an npm workspaces monorepo, so this installs both
   `app/` and `server/`'s dependencies in one pass.
2. Picks free ports for Postgres and the API (starting at `5433`/`3001`, scanning upward
   if those are taken — see [Automatic port selection](./docs/development.md#automatic-port-selection))
   and writes them to `server/.env`, generating a random `JWT_SECRET` the first time only.
3. Starts Postgres via Docker (skipped with instructions if Docker isn't installed).
4. Applies database migrations.

### Step 3: Run it

Two terminals, both from the repo root:

```bash
npm run dev:server   # starts the API — prints the actual port, e.g. "Server listening at http://127.0.0.1:3001"
```

```bash
npm run dev:app      # starts Expo — press i/a, or scan the QR code with Expo Go
```

Working on the web client instead (or as well)? Run this in place of (or alongside)
`dev:app`:

```bash
npm run dev:web       # starts Vite — open the localhost URL it prints in a browser
```

`setup` doesn't always land on `3001` (see step 2.2) — check `server/.env`'s `PORT`, or
just read the port from `dev:server`'s own startup line, before assuming it.

### Step 4: Point the app at your server

**Mobile app** — needs `EXPO_PUBLIC_API_URL` set to wherever your server actually is. Pick
one:

- **Persistent (recommended)** — copy `app/.env.example` to `app/.env` and set it there;
  Expo loads it automatically, no extra setup:
  ```bash
  # app/.env
  EXPO_PUBLIC_API_URL=http://192.168.1.20:3001
  ```
- **One-off** — set it inline for a single run instead:
  ```bash
  cd app && EXPO_PUBLIC_API_URL=http://192.168.1.20:3001 npm run start
  ```

Which host to use:

| Running the app on... | Use |
|---|---|
| Android emulator | `http://10.0.2.2:<port>` (emulator's alias for the host machine — `localhost` won't work) |
| Physical phone (same network as the server) | Your machine's LAN IP, e.g. `http://192.168.1.20:<port>` |
| Physical phone (different network — see [Running the dev server from a remote machine](./docs/development.md#running-the-dev-server-from-a-remote-machine)) | Still your server's real address; also start Expo with `npm run start:tunnel` instead of `npm run dev:app` |
| A deployed server | Its real `https://` URL — see [Deployment](./docs/deployment.md) |

**Web client** — same idea, its own env var: copy `web/.env.example` to `web/.env` and
set `VITE_API_URL` (defaults to `http://localhost:3001`). No emulator/LAN-IP concerns
since it's a regular browser.

### Step 5 (optional): Enable over-the-air app updates

The app checks for OTA updates (via `expo-updates`) on launch and when it comes back to
the foreground, and the Settings screen shows the current version, lets you check
manually, and prompts to restart once an update has downloaded. Skip this step and it
just always shows "Updates aren't available in this build" — harmless, and expected in
Expo Go/local dev regardless.

To enable it (needs a free Expo account):

1. ```bash
   npm i -g eas-cli
   cd app
   eas login
   ```
2. ```bash
   eas update:configure   # links this app to an EAS project and fills in app.json
   ```
3. Whenever you want to ship a JS-only change (no native code changes) without a new app
   build:
   ```bash
   eas update --branch production --message "Describe the change"
   ```

### Staying up to date

```bash
npm run update
```

Pulls the latest commits (only if your working tree is clean — otherwise it tells you to
commit or stash first and stops, rather than risk overwriting anything), reinstalls
dependencies, and applies any new migrations.

## Features

- Multiple jobs, each with a name, color, and one or more named pay rates ("Standard",
  "Holiday", ...) — see [rate history, tiers, and overtime](./docs/data-model.md#rate-history-tiers-and-overtime)
- Rate changes are versioned: editing a job's rate today never changes what a past shift
  is calculated to have paid
- Optional per-job weekly overtime (a threshold + multiplier), applied automatically when
  calculating pay
- Clock in / clock out, with a live-updating elapsed timer; a rate-tier picker appears
  automatically only for jobs that actually have more than one tier
- Clock into multiple jobs at once — each open shift gets its own card with its own timer,
  break controls, and clock-out; a job can't be double-clocked into itself, but a
  different job can run concurrently
- "Clock In At..." / "Clock Out At..." — set an explicit date/time instead of "now", for
  a forgotten clock-in/out
- Breaks (start/end), excluded from worked-hours totals — "Start Break At..." / "End Break
  At..." accept an explicit time the same way clock in/out do
- Per-shift notes/comments, added or edited from the History screen; optionally prompted
  for automatically right after clocking out (Settings toggle)
- History grouped by day, with per-day and per-shift totals and computed pay; multi-select
  (long-press or tap a row while a selection is active) to delete several shifts at once
- CSV export by date range (this week / last week / this month / last 90 days) and job,
  shared via the OS share sheet (iOS/Android)
- Export as a clean, formatted HTML email draft (recipients, subject, and
  earnings/comments/times toggles), opened in your device's mail app for you to review
  and send — see `app/src/lib/exportFormat.ts`. Uses `expo-mail-composer`, which opens
  whatever mail app is set as the device's default (Gmail, Outlook, iOS Mail, ...) — it's
  not tied to any one provider.
- **Timesheets tab**: pick a job, then see its shifts grouped into that job's own
  recurring pay period (weekly/biweekly/monthly — each job configures its own period,
  format, and recipients independently, from that job's settings), with per-entry notes
  shown when enabled. A "Submit Timesheet" button emails the current period to that job's
  assigned **Managers** (a global name+email address book, assigned per job) as CSV,
  formatted plain text, or both — independent of the Export tab's own CSV/HTML-draft flow,
  which is unchanged.
- **Optional per-job time entry rounding**: round each shift's clock-in/out to the
  nearest 5/10/15/20/30/60/120 minutes (up, down, or nearest) before computing hours and
  pay — like a physical timeclock. The actual recorded punch times are never changed,
  only what's used for History totals, Export, and Timesheets.
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
