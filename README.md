# Clocker

Clocker is a timeclock app for tracking hours across multiple jobs: clock in and out,
track breaks, review your history, and send timesheets or export a CSV — all backed by a
small server so your hours stay in sync between your phone and a web browser.

**Just want to use Clocker?** You're in the right repository, but the wrong document — see
the **[User Guide](./docs/user-guide.md)** instead, written for everyday use with no
technical background assumed. Everything below this point is for people setting up,
hosting, or developing Clocker itself.

## What's in this repository

Clocker is built as two apps that share one server, so your data is the same no matter
which one you use:

- **A mobile app** (`app/`) — built with Expo/React Native. It keeps a full copy of your
  data on the phone itself, so it keeps working with no internet connection at all, and
  catches up with the server automatically once you're back online.
- **A web app** (`web/`) — built with Vite/React. It's a simpler, browser-based client
  that talks to the server directly on every action rather than keeping its own local
  copy — the trade-off for not needing anything installed.
- **A server** (`server/`) — a small Fastify API backed by PostgreSQL, handling sign-in
  and keeping both clients' data in sync with each other.
- **Shared code** (`shared/`) — the calculations both apps need to agree on (pay, rounding,
  overtime, and so on) live in one place so neither app can ever compute a different
  number than the other.

For the full picture of *why* it's built this way — and a plain-language explanation of
how the pieces actually fit together — see **[Architecture](./docs/architecture.md)**. For
everything else, see the **[documentation index](./docs/README.md)**, which points you to
the right guide depending on what you're trying to do:

| | |
|---|---|
| [User Guide](./docs/user-guide.md) | Using the app day to day — no technical background needed |
| [Deployment](./docs/deployment.md) | Running your own Clocker server, step by step — no prior deployment experience assumed |
| [Development Guide](./docs/development.md) | Setting up a local copy to write code against |
| [Architecture](./docs/architecture.md) | How the app is put together, and why |
| [Data Model](./docs/data-model.md) | Every piece of data Clocker stores, and where |
| [Sync Protocol](./docs/sync-protocol.md) | Exactly how the phone and server agree on what's changed |
| [API Reference](./docs/api-reference.md) | Every request the app can make to the server |

## Project layout

```
app/       Expo mobile app (screens, local database, sync, sign-in)
web/       Vite web app (browser-only, no local database) — see docs/architecture.md
shared/    Code shared by both apps (types + calculations), so they always agree
server/    The API and its database schema/migrations, plus its Dockerfile
scripts/   Automation for local setup/updates and for production deployment — see docs/
docs/      All detailed documentation (see the table above)
docker-compose.yml        A local database for development
docker-compose.prod.yml   Database + server + reverse proxy, for a real deployment (see docs/deployment.md)
Caddyfile                 Reverse proxy configuration for a real deployment
```

## Setting up a local copy (for development)

Full detail, troubleshooting, and every setting: **[Development Guide](./docs/development.md)**.
This section is the fast path for someone already comfortable with a terminal and Node.js.

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
   eas update:configure   # links this app to an EAS project — see docs/deployment.md
                          # for why app/app.config.js needs the resulting id added by hand
   ```
3. Whenever you want to ship a JS-only change (no native code changes) without a new app
   build:
   ```bash
   npm run deploy:app
   ```
   A native change instead? Just run `npm run deploy` (see
   [Deployment](./docs/deployment.md)) — it builds the app as part of the same command.

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
  calculating pay — plus a manual per-shift override (see below) for a specific shift that
  should count as overtime regardless of the weekly total
- Clock in / clock out, with a live-updating elapsed timer; a rate-tier picker appears
  automatically only for jobs that actually have more than one tier
- Clock into multiple jobs at once — each open shift gets its own card with its own timer,
  break controls, and clock-out; a job can't be double-clocked into itself, but a
  different job can run concurrently
- "Clock In At..." / "Clock Out At..." — set an explicit date/time instead of "now", for
  a forgotten clock-in/out; a ✕ button on an open shift cancels a mistaken clock-in
  entirely, recording no shift at all
- Breaks (start/end), excluded from worked-hours totals — "Start Break At..." / "End Break
  At..." accept an explicit time the same way clock in/out do
- Per-shift notes/comments — addable at any point while still clocked in, not just
  afterward — and editable from the History screen; optionally prompted for automatically
  right after clocking out (per-job setting)
- Optional per-job weekly hours target — shows remaining hours this week, an expected
  clock-out time while clocked in, and (once the target's reached) exactly how far over it
  you are, right on the Clock screen
- **Manual per-shift overtime**: mark a specific shift as overtime from its entry in
  History — pays it entirely at the job's overtime rate regardless of the weekly
  threshold, and excludes it from the weekly hours target above
- Android: a persistent notification while clocked into any job, showing the job(s),
  start time, and current elapsed hours — needs a custom dev/production build, not Expo
  Go (see `docs/development.md`)
- History grouped by day, with per-day and per-shift totals and computed pay; multi-select
  (long-press or tap a row while a selection is active) to delete several shifts at once
- Tap any shift (still clocked in or already closed) to open its full editor: correct the
  clock-in/out date and time, add/edit/delete breaks, edit its note, and mark it overtime
  — no more delete-and-recreate to fix a mistake
- CSV export by date range (this week / last week / this month / last 90 days / a custom
  start-end range) and job, shared via the OS share sheet (iOS/Android)
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
- An in-app Help screen (Settings → Help, both clients) covering how to use every part of
  the app, plus a step-by-step setup guide at the top of Settings → Backups
- **Self-hosting tools, for whoever runs the server**: an in-app "Update Server" button
  that pulls and redeploys the latest code with no need to SSH in, and encrypted,
  deduplicated backups (BorgBackup) with four restore modes (data only, app config only,
  app version only, or all three together) — see [Deployment](./docs/deployment.md).

## Notes for future work

- Export/Timesheet submission works on both clients, via different mechanisms per
  platform (see `CLAUDE.md`): mobile opens a native email draft via `expo-mail-composer`
  (HTML formatting there is "not working perfectly on Android" per that library's own
  docs — richest on iOS Mail and most desktop clients); web downloads a CSV and copies
  formatted text to the clipboard, then opens a `mailto:` link, since browsers have
  neither a share sheet nor a mail composer to call into.
- Automatic weekly overtime is calculated only over the shifts in whatever date range you
  export — pass a full calendar week (e.g. "This Week") for an exactly correct weekly
  overtime total.
- A "remember me" JWT (checked by default) never expires and there's no refresh/revocation
  flow beyond rotating `JWT_SECRET` (logs out every device) — fine for a personal app,
  worth revisiting if this ever gets multi-user.
- Settings' "Update Server" button and Backups screen both reuse the app's own auth token
  against a separate host-side service (`scripts/host-agent.mjs`) rather than a dedicated
  admin role — same reasoning as above, fine for one user.
- Settings → Backups needs `borg` installed on the deploy host (`apt install borgbackup`)
  to actually create/restore anything — the config UI itself works without it, but a
  backup attempt will fail until it's present. See
  [`docs/deployment.md#backups-borgbackup`](./docs/deployment.md#backups-borgbackup).
