# Architecture

Clocker is a monorepo with four workspaces:

```
app/       Expo (React Native + TypeScript) mobile client — offline-first, local SQLite
web/       Vite + React + TypeScript web client — thin, server-dependent, no local DB
shared/    Framework-free TypeScript shared by both clients (types + pure calculations)
server/    Fastify + Prisma + PostgreSQL API
scripts/   Dev environment automation (setup.mjs, update.mjs)
```

Both clients talk to the server over the same small HTTP API — auth plus two sync
endpoints — documented in [`api-reference.md`](./api-reference.md). Everything about how
data is stored and kept in sync (on the mobile client — see below for how the web client
differs) is in [`data-model.md`](./data-model.md) and
[`sync-protocol.md`](./sync-protocol.md).

## Two frontend clients, one API

`app/` and `web/` are siblings, not layers — neither imports from the other, and neither
knows the other exists. Each depends only on `shared/` (pure types and calculations — see
below) and on the server's HTTP contract. This was a deliberate split, not the starting
design: an earlier version tried to run the mobile app's *entire* local-first
architecture — local SQLite via `expo-sqlite`, in the browser via its experimental
WASM/Web Worker backend — as a third Expo target ("web"), reusing the same React Native
components via `react-native-web`. That got far enough to bundle successfully, but was
permanently blocked by an upstream Expo bug ([expo/expo#38481](https://github.com/expo/expo/issues/38481))
that prevents the page from ever becoming cross-origin-isolated, which `SharedArrayBuffer`
(and therefore that SQLite backend) requires.

Stepping back, forcing a browser tab into the same architecture as a phone was the wrong
goal regardless of that specific bug:

- A phone can plausibly go offline for hours (airplane mode, no signal, dead zone) and
  needs to keep working — that's the entire reason `app/` is local-first (see below). A
  browser tab reasonably can't make the same promise (close the tab and *everything*
  in-memory is gone anyway), so paying the complexity cost of a local outbox/sync engine
  buys `web/` far less than it buys `app/`.
- Browsers don't have SQLite. Faking it (WASM SQLite compiled to run in a Web Worker) is
  exactly the kind of "make platform B pretend to be platform A" approach that produces
  bugs like the one above — a browser's real, native offline storage is IndexedDB/OPFS, a
  fundamentally different model, not a drop-in SQLite replacement.
- `expo-sharing`/`expo-mail-composer` (used for CSV export and the Timesheets tab's email
  submission) have no web implementation at all regardless — so even a working web-SQLite
  target would still need real platform-specific branches for those features. The
  "shared codebase" premise was already false at the feature level, not just storage.

So `web/` (see [`../web/src/api.ts`](../web/src/api.ts)) is a **thin client**: no local
database, no outbox, no offline story. Every mutation calls `POST /sync/push` immediately
with just that one change; every read calls `GET /sync/pull` with no cursor and replaces
its in-memory state wholesale. This reuses the *existing* sync endpoints exactly as
written — no new server routes were needed — because `/sync/push`/`/sync/pull` already
work as generic "send some changes"/"give me everything since X" endpoints; a thin client
just calls them differently than the mobile app's outbox does (see
[`sync-protocol.md`](./sync-protocol.md) for how the mobile app uses the same endpoints).

**What's actually shared** lives in `shared/` (`@clocker/shared`): `types.ts` (the
`Job`/`Shift`/etc. shapes both clients and the server agree on), and pure calculation
functions with zero React/React Native/browser dependencies — `pay.ts` (rate/overtime
math), `rounding.ts` (time-entry rounding), `timesheetPeriods.ts` (period boundaries),
`exportFormat.ts` (CSV/HTML/text builders), `time.ts` (duration/formatting helpers). Both
Metro (`app/metro.config.js`) and Vite (`web/vite.config.ts`) are configured to resolve it
straight from source (`shared/src`) as an npm workspace package — no build step, no
published version, just a sibling folder each bundler is told to watch.

## Design principle: local-first (`app/`, the mobile client)

Everything in this section and the next few is specific to `app/` — the web client
(`web/`) is deliberately *not* local-first; see
[Two frontend clients, one API](#two-frontend-clients-one-api) above for why.

The mobile app never blocks on the network. Every screen reads and writes a local SQLite
database (`app/src/db`) directly; the server and the sync layer exist purely to back that
data up and propagate it to other devices. Concretely:

- Clocking in, starting a break, adding a job — all of it is a synchronous-feeling SQLite
  write. There is no "waiting for the server" state anywhere in the UI.
- The app is fully usable with the server unreachable (airplane mode, no signal, server
  down). Changes queue locally and sync once connectivity returns.
- Sync is opportunistic, not required: it runs on launch, on returning to the foreground,
  every 5 minutes in the background, and on a manual "Sync Now" button — never as a
  precondition for using the app.

This shaped several concrete choices below.

## Why client-generated UUIDs

Every `Job`, `Shift`, and `Break` gets its `id` from `randomUUID()` on the client, at
creation time — not from the server (`expo-crypto`'s implementation on `app/`, the
standard `crypto.randomUUID()` browsers now ship natively on `web/`). This is what makes
offline-first possible at all on the mobile client: it needs a stable identity for a row
before it's ever talked to the server (so it can reference a shift's job, or a break's
shift, before either has synced), and two devices need to be able to create rows
concurrently without colliding. `web/` doesn't need this for offline reasons (it has no
offline story), but generates ids the same way anyway — one less thing for the server's
ownership checks to special-case per client. UUIDv4 collision risk is negligible at this
scale either way.

## Why an outbox table instead of a "dirty" flag

Rather than a boolean column on each row, local writes are tracked in a separate
`pending_changes` table (`entity_type`, `entity_id`, `op`) — see
[`data-model.md`](./data-model.md#pending_changes). This keeps "what needs to sync" as
one small table to scan (cheap even with a large history) and makes the push step trivial:
read the outbox, look up each referenced row's current state, send it, clear the outbox
entries that were sent. A repeated edit to the same row before syncing just upserts one
outbox row (`entity_type` + `entity_id` is the primary key) — no duplicate pushes.

## Why last-write-wins, not a CRDT

Clocker is built for one person using at most a couple of devices, not concurrent
multi-user editing. A genuine conflict (the same shift edited offline on two devices
before either synced) is rare and, when it happens, losing the losing device's edit to
last-write-wins is an acceptable trade for the simplicity of not needing operational
transforms or CRDTs. See [`sync-protocol.md`](./sync-protocol.md#conflict-resolution) for
exactly how "last write" is determined.

## Why rate is versioned history, not a flat number on Job

Early on, `Job.hourlyRateCents` was a single flat field. It was replaced with `RateTier` +
`RateVersion` (see [`data-model.md`](./data-model.md#rate-history-tiers-and-overtime)) for
three reasons that turned out to be one underlying requirement: **a rate change today must
never retroactively change what a past shift is calculated to have paid.**

- A flat field can't represent "this job pays differently for holiday hours" without
  either a second `Job` row (duplicating the job in every list/picker) or an ad-hoc
  encoding — `RateTier` gives that a real, named place to live.
- A flat field edited in place loses the old value the moment you change it — there's no
  way to answer "what did this shift actually pay, per the rate at the time" after a
  raise. `RateVersion.effectiveFrom` keeps every value that was ever active and when.
- Overtime (`Job.overtimeMultiplier` / `overtimeWeeklyThresholdHours`) reads the resolved
  rate the same way regular hours do — it's a multiplier applied at calculation time
  (`shared/src/pay.ts`, so both clients compute identical pay), not a separate stored
  rate, so it inherits rate history for free.

The cost is real: a job's pay now requires a join (job → tier → version) instead of a
column read, and the Clock screen has to ask which tier a shift is worked under whenever a
job has more than one. That's judged worth it because the alternative — a number that
silently redefines history when you change it — is the kind of bug a personal finance/pay
app can't afford to have.

## Why a custom Fastify server instead of a BaaS

This was a deliberate choice (over Supabase/Firebase) to keep the whole stack — client,
API, database — owned and inspectable, with no vendor-specific SDK or query language baked
into the sync logic. The trade-off is that auth, migrations, and hosting are the app's own
responsibility rather than a platform's; see [`development.md`](./development.md) and
[`deployment.md`](./deployment.md) for what that involves in practice.

## Request flow

**Mobile (`app/`)** — local-first, syncs opportunistically:

```
┌─────────────┐        ┌──────────────┐        ┌─────────────┐
│   Screens    │──────▶│  SQLite (app) │        │             │
│ (React Native)│◀──────│ + outbox table│        │             │
└─────────────┘        └──────┬───────┘        │             │
       ▲                       │ sync()          │             │
       │              ┌────────▼────────┐        │  PostgreSQL │
       └──────────────│  Fastify API     │◀──────▶│  (Prisma)   │
      (auth token)     │  /auth, /sync    │        │             │
                        └─────────────────┘        └─────────────┘
```

- Screens never call the API directly — only `app/src/db/database.ts` (local reads/writes)
  and `app/src/sync/sync.ts` (the only thing that calls `app/src/sync/api.ts`).

**Web (`web/`)** — thin, calls the same API directly, no local step in between:

```
┌─────────────┐   push/pull   ┌──────────────┐        ┌─────────────┐
│   App.tsx    │──────────────▶│  Fastify API │◀──────▶│  PostgreSQL │
│  (React)     │◀──────────────│  /auth, /sync│        │  (Prisma)   │
└─────────────┘  (auth token)  └──────────────┘        └─────────────┘
```

- `web/src/App.tsx` calls `web/src/api.ts` directly on every mutation and every refresh —
  there's no local database or outbox layer to go through first.

Neither client's storage layer knows the other exists — both `app/src/sync/api.ts` and
`web/src/api.ts` independently call the *same* server endpoints, which is the whole point
(see [Two frontend clients, one API](#two-frontend-clients-one-api) above). The server
never talks back to a specific device/tab outside of a pull response either way — there's
no push notification / websocket layer. A client only learns about another client's
changes the next time it happens to pull.

## OTA updates (mobile only)

Separately from data sync, `app/` can also update its own JavaScript bundle over the air
via `expo-updates` (see [`development.md`](./development.md#ota-updates)). This has nothing
to do with the Fastify server — it talks to Expo's EAS Update service instead. `web/` has
no equivalent concept, or need for one — every page load already fetches the latest
deployed build, the same way any static website does.
