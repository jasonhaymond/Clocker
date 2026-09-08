# Architecture

Clocker is a monorepo with two workspaces:

```
app/       Expo (React Native + TypeScript) client
server/    Fastify + Prisma + PostgreSQL API
scripts/   Dev environment automation (setup.mjs, update.mjs)
```

They talk to each other over a small HTTP API — auth plus two sync endpoints — documented
in [`api-reference.md`](./api-reference.md). Everything about how data is stored and kept
in sync is in [`data-model.md`](./data-model.md) and [`sync-protocol.md`](./sync-protocol.md).

## Design principle: local-first

The app never blocks on the network. Every screen reads and writes a local SQLite database
(`app/src/db`) directly; the server and the sync layer exist purely to back that data up and
propagate it to other devices. Concretely:

- Clocking in, starting a break, adding a job — all of it is a synchronous-feeling SQLite
  write. There is no "waiting for the server" state anywhere in the UI.
- The app is fully usable with the server unreachable (airplane mode, no signal, server
  down). Changes queue locally and sync once connectivity returns.
- Sync is opportunistic, not required: it runs on launch, on returning to the foreground,
  every 5 minutes in the background, and on a manual "Sync Now" button — never as a
  precondition for using the app.

This shaped several concrete choices below.

## Why client-generated UUIDs

Every `Job`, `Shift`, and `Break` gets its `id` from `expo-crypto`'s `randomUUID()` on the
device, at creation time — not from the server. This is what makes offline-first possible
at all: the app needs a stable identity for a row before it's ever talked to the server
(so it can reference a shift's job, or a break's shift, before either has synced), and two
devices need to be able to create rows concurrently without colliding. UUIDv4 collision
risk is negligible at this scale.

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

## Why a custom Fastify server instead of a BaaS

This was a deliberate choice (over Supabase/Firebase) to keep the whole stack — client,
API, database — owned and inspectable, with no vendor-specific SDK or query language baked
into the sync logic. The trade-off is that auth, migrations, and hosting are the app's own
responsibility rather than a platform's; see [`development.md`](./development.md) and
[`deployment.md`](./deployment.md) for what that involves in practice.

## Request flow

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
- The server never talks back to a specific device outside of a pull response — there's no
  push notification / websocket layer. A device only learns about another device's changes
  the next time it happens to sync.

## OTA updates

Separately from data sync, the app can also update its own JavaScript bundle over the air
via `expo-updates` (see [`development.md`](./development.md#ota-updates)). This has nothing
to do with the Fastify server — it talks to Expo's EAS Update service instead.
