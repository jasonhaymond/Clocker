# Data Model

There are two copies of the schema: PostgreSQL (server, via Prisma — the durable source of
truth across devices) and SQLite (client, hand-written SQL — the copy the UI actually reads
and writes). They're kept in sync by the protocol in
[`sync-protocol.md`](./sync-protocol.md); this doc just covers the shape of the data itself.

## Entities

```
User 1──* Job 1──* Shift 1──* Break
```

- **User** — email + bcrypt password hash. Server-only; the client never stores a local
  copy, just the JWT (see [`api-reference.md`](./api-reference.md#authentication)).
- **Job** — something you clock time against: a name, a display color, an optional hourly
  rate, and an archived flag (archived jobs disappear from the Clock screen's picker but
  stay visible/editable in Jobs and still show up in History/Export).
- **Shift** — one clock-in/clock-out span for a job. `clockOut` is `null` while the shift
  is open; at most one shift is open at a time app-wide (enforced in
  `app/src/db/database.ts`'s `clockIn()`, not at the database level).
- **Break** — one pause within a shift. `end` is `null` while the break is open. Break time
  is subtracted from a shift's worked-hours total (`app/src/lib/time.ts`'s `workedMillis`).

## Server schema (PostgreSQL / Prisma)

Source of truth: [`server/prisma/schema.prisma`](../server/prisma/schema.prisma).

| Model | Field | Type | Notes |
|---|---|---|---|
| **User** | `id` | `String` (uuid) | primary key |
| | `email` | `String` | unique |
| | `passwordHash` | `String` | bcrypt, cost 12 |
| | `createdAt` | `DateTime` | |
| **Job** | `id` | `String` (uuid) | primary key, **client-generated** |
| | `userId` | `String` | FK → User, cascade delete |
| | `name` | `String` | |
| | `colorHex` | `String` | default `#2563eb` |
| | `hourlyRateCents` | `Int?` | integer cents to avoid float rounding; `null` = no rate set |
| | `archived` | `Boolean` | default `false` |
| | `createdAt` / `updatedAt` | `DateTime` | `updatedAt` is Prisma's `@updatedAt` — server-set on every write, and the field sync pulls by |
| | `deletedAt` | `DateTime?` | soft delete (tombstone) — see sync protocol |
| **Shift** | `id` | `String` (uuid) | primary key, **client-generated** |
| | `userId` | `String` | FK → User, cascade delete |
| | `jobId` | `String` | FK → Job, cascade delete |
| | `clockIn` | `DateTime` | |
| | `clockOut` | `DateTime?` | `null` while open |
| | `notes` | `String?` | free text; not currently editable from the UI, but round-trips through sync/export |
| | `createdAt` / `updatedAt` / `deletedAt` | | same semantics as Job |
| **Break** | `id` | `String` (uuid) | primary key, **client-generated** |
| | `shiftId` | `String` | FK → Shift, cascade delete |
| | `start` | `DateTime` | |
| | `end` | `DateTime?` | `null` while open |
| | `createdAt` / `updatedAt` / `deletedAt` | | same semantics as Job |

Indexes: `Job` and `Shift` are indexed on `(userId, updatedAt)` (the sync pull query's
access pattern), `Shift` also on `jobId`, `Break` on `(shiftId, updatedAt)`.

Note `Break` has no `userId` column — ownership is checked transitively through its
`Shift` (see `upsertOwnedBreak` in `server/src/routes/sync.ts`).

## Client schema (SQLite)

Source of truth: [`app/src/db/schema.ts`](../app/src/db/schema.ts). Column names are
`snake_case` (raw SQL) where the server/TypeScript types are `camelCase`; the mapping
functions live in `app/src/db/database.ts` (`rowToJob`, `rowToShift`, `rowToBreak`).

**`jobs`**, **`shifts`**, **`breaks`** mirror the server tables above one-for-one (same
fields, `snake_case` names, `TEXT` for all dates/timestamps as ISO-8601 strings, `INTEGER`
0/1 for booleans). There is no `userId` column client-side — the local database only ever
holds one signed-in user's data, so it's implicit.

Two extra tables exist only on the client, for sync bookkeeping:

#### `pending_changes`

```sql
CREATE TABLE pending_changes (
  entity_type TEXT NOT NULL,   -- 'job' | 'shift' | 'break'
  entity_id   TEXT NOT NULL,
  op          TEXT NOT NULL,   -- 'upsert' | 'delete'
  PRIMARY KEY (entity_type, entity_id)
);
```

The outbox: one row per local entity that has changed since the last successful push. See
[`sync-protocol.md`](./sync-protocol.md#the-outbox) for how it's used.

#### `sync_state`

```sql
CREATE TABLE sync_state (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
```

A generic key/value table with a single row today: `last_synced_at`, the ISO timestamp
cursor for the next pull. Shown to you as "Last synced" on the Settings screen.

## TypeScript types

`app/src/types.ts` defines the client-side shape (`Job`, `Shift`, `Break`,
`EntityType`, `PendingOp`) used throughout the app and by the sync client. These
intentionally match the server's JSON response shape field-for-field (Prisma's `Date`
fields serialize to ISO strings over HTTP, which is exactly what the client stores), so
`app/src/sync/sync.ts` can push/pull without a translation layer beyond
`snake_case`/`camelCase` mapping.
