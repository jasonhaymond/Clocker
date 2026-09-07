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
  resolve last-write-wins by `updatedAt`. See the comment at the top of
  `server/src/routes/sync.ts` for the full protocol.

## Project layout

```
app/       Expo app (screens, local DB, sync client, auth)
server/    Fastify API + Prisma schema/migrations
docker-compose.yml   Local Postgres for development
```

## Getting started

### 1. Server

```bash
cp server/.env.example server/.env   # edit JWT_SECRET for anything beyond local dev
docker compose up -d                 # starts Postgres on localhost:5433
npm run db:migrate                   # applies Prisma migrations
npm run dev:server                   # starts the API on http://localhost:3001
```

### 2. App

The app needs to know where your server is. Android emulator can't reach `localhost`
directly — use `10.0.2.2`; a physical device needs your machine's LAN IP.

```bash
cd app
EXPO_PUBLIC_API_URL=http://localhost:3001 npm run start
```

Then press `i` (iOS simulator), `a` (Android emulator), or scan the QR code with Expo Go
on a physical device.

## Features

- Multiple jobs, each with a name, color, and optional hourly rate
- Clock in / clock out, with a live-updating elapsed timer
- Breaks (start/end), excluded from worked-hours totals
- History grouped by day, with per-day and per-shift totals
- CSV export by date range (this week / last week / this month / last 90 days) and job,
  shared via the OS share sheet (iOS/Android)
- Offline-first: every action works with no network; a manual "Sync Now" plus automatic
  background sync push changes and pull updates from other devices

## Notes for future work

- Editing a shift's clock-in/clock-out time from the History screen isn't wired up yet
  (delete + re-create is the current workaround).
- Export is iOS/Android only for now (`expo-sharing` has no web support).
- The JWT has a 180-day expiry and there's no refresh flow — fine for a personal app,
  worth revisiting if this ever gets multi-user.
