# Sync Protocol

How a device's local SQLite database and the server's PostgreSQL database converge. This
is the part of the app most worth understanding before changing anything in
`app/src/db`, `app/src/sync`, or `server/src/routes/sync.ts` — a subtle bug here means
silently lost or duplicated hours, not just a crash.

## When sync runs

`app/src/navigation/RootNavigator.tsx` calls `synchronize()` (from `app/src/sync/sync.ts`):

- once when the signed-in tab navigator mounts (app launch / sign-in)
- every 5 minutes while the app is open (`SYNC_INTERVAL_MS`)
- whenever the app returns to the foreground (`AppState` listener)
- on demand, from the "Sync Now" button on the Settings screen

`synchronize()` also guards against overlapping runs with an in-memory `syncing` flag — if
one of the triggers above fires while a sync is already in flight, that call is a silent
no-op rather than a second concurrent push/pull.

Individual mutations (clock in, start a break, add a job, ...) do **not** wait for
`synchronize()` — see [`architecture.md`](./architecture.md#design-principle-local-first).
`ClockScreen` fires `synchronize().catch(() => {})` after each action as a best-effort
nudge, but the write itself already completed locally before that call happens.

## The outbox

Every local write (in `app/src/db/database.ts`) does two things inside its function body:
the actual SQLite write, then `markPending(entityType, entityId, op)`, which upserts a row
into `pending_changes` (see [`data-model.md`](./data-model.md#pending_changes)):

```ts
await db.runAsync("INSERT INTO jobs (...) VALUES (...)", [...]);
await markPending("job", id, "upsert");
```

Because `(entity_type, entity_id)` is the outbox's primary key, editing the same row
multiple times before a sync just keeps one outbox entry — there's no history of
intermediate edits to replay, only "this row needs to go out, in its current state."
Deleting a row overwrites any pending `upsert` for that id with `delete`.

## Push

`synchronize()` reads the entire outbox, and for each entry:

- if `op === "delete"`, adds the id to the relevant `deletedJobIds` / `deletedRateTierIds` /
  `deletedRateVersionIds` / `deletedShiftIds` / `deletedBreakIds` / `deletedManagerIds`
  array
- if `op === "upsert"`, reads the row's **current** state straight from its table (not
  from the outbox — the outbox only ever stores an id and an op) and adds it to the
  relevant `jobs` / `rateTiers` / `rateVersions` / `shifts` / `breaks` / `managers` array

That payload goes to `POST /sync/push` (see
[`api-reference.md`](./api-reference.md#post-syncpush)). The server applies the upsert
arrays **in this order** — jobs, then rate tiers, then rate versions, then shifts, then
breaks, then managers — scoped to the authenticated user (the `upsertOwned*` helpers in
`server/src/routes/sync.ts`) — see [ownership checks](#ownership-checks) below — and
soft-deletes anything in the deleted-id arrays by setting `deletedAt = now()`. **Rows are
never hard-deleted server-side.**

The ordering matters because each entity's ownership check looks up its parent: a rate
tier's push is dropped unless its `jobId` already resolves to a job this user owns, and
that job might be in the *same* push (e.g. a brand-new job created offline, with its
default tier and first rate all queued together) — so jobs must land first, tiers before
the versions that reference them, and so on down to breaks. `Manager` has no parent (it
hangs directly off `userId`, like `Job`), so its position in the order doesn't matter.

Only on a successful push does the client clear the outbox entries it just sent
(`clearPendingChanges`). If the push request fails (offline, server down, validation
error), the outbox is untouched and the same rows go out again on the next sync attempt.

## Pull

After pushing, the client calls `GET /sync/pull?since=<cursor>`, where `<cursor>` is the
`serverTimestamp` returned by the *previous* pull (stored in the `sync_state` table,
`null`/absent on a device's first-ever sync, which the server treats as "the beginning of
time"). The server returns every `Job`, `RateTier`, `RateVersion`, `Shift`, `Break`, and
`Manager` belonging to that user whose `updatedAt` is strictly greater than `since` —
**including soft-deleted ones**, so the client can find out about deletions.

The client applies each returned row with an `INSERT ... ON CONFLICT(id) DO UPDATE`
(`upsertLocalJob` / `upsertLocalRateTier` / `upsertLocalRateVersion` / `upsertLocalShift` /
`upsertLocalBreak` / `upsertLocalManager`), unconditionally overwriting its local copy — see
[Conflict resolution](#conflict-resolution). If a returned row has a non-null `deletedAt`,
it's written into the local table as such rather than removed from SQLite; every read
query in `database.ts` filters `WHERE deleted_at IS NULL`, so it disappears from the UI
without needing a separate "apply tombstone" code path.

Finally, the client saves the pull response's `serverTimestamp` as its new cursor. Using
the *pull's* timestamp (captured after the push already landed) rather than, say, the time
the sync started, means a row this device just pushed will legitimately come back on this
same pull (harmless — it's an idempotent overwrite with identical data) but won't be
fetched *again* on the next sync.

## Conflict resolution

There's no merge logic — the last write to reach the server for a given row simply wins,
full stop. Concretely: `updatedAt` is Prisma's `@updatedAt`, so it's set by the server
processing the push, not by the client's local edit time. If a shift is edited offline on
two devices before either syncs, whichever device's push reaches the server second
overwrites the first device's edit entirely (not merged field-by-field). See
[`architecture.md`](./architecture.md#why-last-write-wins-not-a-crdt) for why this
trade-off was made.

One consequence worth knowing: the client never sends its own notion of `updatedAt` in a
push payload, and the server ignores it if it did (none of the `*Input` zod schemas in
`server/src/routes/sync.ts` even declare that field) — so there's no way for a stale
client to "win" by claiming a fake newer timestamp. This applies to rate history too: a
`RateVersion`'s `effectiveFrom` is client-supplied (it has to be — it can legitimately be
backdated, e.g. correcting a rate that should have applied last month), but its
`updatedAt`/ownership are still entirely server-controlled the same as everything else.

## Ownership checks

Every row a push touches is scoped to the authenticated user before being written:

- `Job` rows: `updateMany({ where: { id, userId } })`, falling back to `create` only if
  that update matched zero rows.
- `RateTier` rows: same pattern, plus the referenced `jobId` must resolve to a job owned
  by this user, or the tier is silently dropped.
- `RateVersion` rows: same pattern, plus the referenced `tierId` must resolve to a tier
  owned (transitively, via its job) by this user, or the version is silently dropped.
- `Shift` rows: same pattern, plus the referenced `jobId` must resolve to a job owned by
  this user (or the shift is silently dropped), and if `rateTierId` is set, it must
  resolve to a tier belonging to *that same job* (or the shift is silently dropped) —
  a shift can't reference another job's tier.
- `Break` rows: same pattern via a join through `shift.userId` (breaks have no `userId`
  column of their own), and the referenced `shiftId` must resolve to a shift owned by this
  user, or the break is silently dropped.
- `Manager` rows: same pattern as `Job` — `updateMany({ where: { id, userId } })`, falling
  back to `create` only if that update matched zero rows. No parent to check, since a
  manager doesn't reference anything else.

This means a client can never overwrite another user's row even if it somehow sent that
row's id (a guessed UUID, a bug, a replayed payload) — the `updateMany` simply matches zero
rows for a foreign id, and the subsequent `create` then fails on the primary key
conflict... which is exactly why the check is `updateMany` **then** `create`, never a
blind `upsert` by id alone.

## What sync deliberately does not do

- **No realtime push.** A device only learns about another device's changes the next time
  it runs `synchronize()` — there's no websocket or push notification layer.
- **No partial/streaming sync.** Every push and pull is a single request; there's no
  pagination for a very large `pending_changes` outbox or a very old cursor. This is a
  reasonable trade for a single-user app's data volumes, and would need revisiting before
  this became multi-user or long-lived enough to matter.
- **No retry/backoff policy.** A failed sync just waits for the next opportunistic trigger
  (foreground, 5-minute timer, manual button) — there's no exponential backoff or queued
  retry beyond that.
