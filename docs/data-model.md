# Data Model

There are two copies of the schema: PostgreSQL (server, via Prisma — the durable source of
truth across devices) and SQLite (client, hand-written SQL — the copy the UI actually reads
and writes). They're kept in sync by the protocol in
[`sync-protocol.md`](./sync-protocol.md); this doc just covers the shape of the data itself.

## Entities

```
User 1──* Job 1──* RateTier 1──* RateVersion
   │          │
   │          ├──* Shift ──> RateTier (optional)
   │          │      │
   │          │      └──* Break
   │          │
   │          └──* JobManager ──> Manager
   │
   └──* Manager
```

- **User** — email + bcrypt password hash. Server-only; the client never stores a local
  copy, just the JWT (see [`api-reference.md`](./api-reference.md#authentication)).
- **Job** — something you clock time against: a name, a display color, an archived flag
  (archived jobs disappear from the Clock screen's picker but stay visible/editable in
  Jobs and still show up in History/Export), optional weekly overtime settings, optional
  time-entry rounding, and its own Timesheets-tab period/submission settings — see
  [Timesheet periods, submission settings, and rounding](#timesheet-periods-submission-settings-and-rounding-per-job)
  below.
- **RateTier** — a named rate under a job (most jobs have exactly one, called "Standard",
  created automatically with the job). Lets a job have more than one rate — e.g.
  "Standard" vs "Holiday" — and lets a shift record which one it was worked under.
- **RateVersion** — a rate tier's dollar value, effective from a point in time. Changing a
  rate adds a new version rather than editing the old one, so a shift's pay is always
  computed from whatever was active when it actually happened — see
  [Rate history](#rate-history-tiers-and-overtime) below and `app/src/lib/pay.ts`.
- **Shift** — one clock-in/clock-out span for a job, optionally tagged with which
  `RateTier` it was worked under (`null` means "the job's default tier," resolved at
  pay-calculation time). `clockOut` is `null` while the shift is open. Multiple shifts —
  for different jobs — can be open at once (clocking into two jobs simultaneously is
  allowed); a single job can only have one open shift of its own at a time, enforced in
  `app/src/db/database.ts`'s `clockIn()` (via `getOpenShiftForJob`), not at the database
  level. `clockIn`/`clockOut` default to "now" but accept an explicit timestamp (the
  Clock screen's "At..." buttons), for backdating a forgotten clock-in/out. `notes` is a
  free-text comment, editable from the History screen.
- **Break** — one pause within a shift. `end` is `null` while the break is open. Break time
  is subtracted from a shift's worked-hours total (`app/src/lib/time.ts`'s `workedMillis`).
- **Manager** — a saved recipient (name + email) for the Timesheets tab's "Submit
  Timesheet" flow: a global address book entry, managed from any job's settings
  (`JobDetailModal`'s "Submit to" section) but not itself tied to one job.
- **JobManager** — a plain join row assigning a `Manager` as a submission recipient for one
  specific `Job`'s timesheets. A manager can be assigned to several jobs, and a job can
  submit to several managers; this table is the only place that relationship is recorded
  (no fields of its own beyond the two ids).

## Rate history, tiers, and overtime

Three related features, one design: a job's pay is never a single flat number baked into
the `Job` row.

- **Rate history** — `RateVersion.effectiveFrom` means a rate change today never rewrites
  what a shift from last month is calculated to have paid. `app/src/lib/pay.ts`'s
  `resolveRateCents` picks the version with the latest `effectiveFrom` at or before the
  shift's `clockIn`.
- **Multiple tiers** — a `Shift.rateTierId` records which of the job's tiers applied. Most
  shifts use `null` (defer to the job's default tier), so single-rate jobs — the common
  case — never have to think about tiers at all; the Clock screen only shows a tier picker
  when a job actually has more than one non-archived tier.
- **Overtime** — `Job.overtimeMultiplier` and `Job.overtimeWeeklyThresholdHours` (both
  `null` together = disabled) apply per ISO week (Monday–Sunday, in the device's local
  time) across all of a job's shifts that week. `calculateShiftPay` walks a job's shifts in
  chronological order, filling the "regular" bucket up to the threshold and paying anything
  past it — even splitting a single shift across the boundary — at rate × multiplier. This
  is computed only over whatever shifts you hand it (e.g. the shifts in an export's date
  range), so for an exact weekly overtime total, pass a full calendar week.

## Timesheet periods, submission settings, and rounding (per job)

Every job carries its own Timesheets-tab configuration directly as fields on the `Job` row
— unlike `promptForNotesOnClockOut` (a genuine device-only preference), this is real job
data other devices need to see the same way, so it's synced like everything else on `Job`
rather than living in `app/src/lib/preferences.ts`/AsyncStorage. Different jobs can
legitimately pay on different schedules and report to different people, which is why this
is per-job rather than one app-wide setting.

- **Period definition** — `timesheetPeriodType` (`"weekly"` | `"biweekly"` | `"monthly"`),
  `timesheetWeekStartDay` (0=Sun..6=Sat, used by weekly/biweekly), `timesheetBiweeklyAnchor`
  (a known period-start date, fixing which week of a pair is "week one"), and
  `timesheetMonthlyStartDay` (1-28). `app/src/lib/timesheetPeriods.ts`'s
  `periodContaining`/`shiftPeriod` compute period boundaries from these (via
  `jobPeriodSettings(job)`, which just narrows a `Job` down to the fields they need).
- **Submission settings** — `timesheetFormat` (`"csv"` | `"text"` | `"both"`) and the
  `timesheetIncludeEarnings`/`timesheetIncludeNotes`/`timesheetIncludeTimes` toggles control
  what the Timesheets tab's "Submit Timesheet" button emails to the job's assigned
  managers (via `JobManager`). All configured from `JobDetailModal`.
- **Time entry rounding** — `roundingEnabled`, `roundingMode` (`"up"` | `"down"` |
  `"nearest"`), and `roundingIncrementMinutes` (5/10/15/20/30/60/120). When enabled,
  `app/src/lib/rounding.ts`'s `roundedWorkedMillis` rounds a *closed* shift's clock-in and
  clock-out to the nearest increment before computing worked time — the same way a
  physical timeclock rounds punches. The shift's stored `clockIn`/`clockOut` are never
  altered; rounding only affects computed hours/pay, applied consistently everywhere
  hours are calculated (`groupShiftsByJob` in `exportFormat.ts`, used by both the Export
  and Timesheets tabs, and `HistoryScreen`'s own pay/duration calculations). A still-open
  shift is never rounded. Breaks are never rounded, only the shift's own start/end.

## Server schema (PostgreSQL / Prisma)

Source of truth: [`server/prisma/schema.prisma`](../server/prisma/schema.prisma). Migration
history — including the backfill that moved existing flat `Job.hourlyRateCents` values into
`RateTier`/`RateVersion` rows when this schema shipped — lives under
[`server/prisma/migrations`](../server/prisma/migrations).

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
| | `archived` | `Boolean` | default `false` |
| | `overtimeMultiplier` | `Float?` | e.g. `1.5`; `null` disables overtime for this job |
| | `overtimeWeeklyThresholdHours` | `Float?` | e.g. `40`; `null` disables overtime for this job |
| | `timesheetPeriodType` | `String` | `"weekly"` (default) \| `"biweekly"` \| `"monthly"` |
| | `timesheetWeekStartDay` | `Int` | default `1` (Monday); 0=Sun..6=Sat |
| | `timesheetBiweeklyAnchor` | `DateTime` | default now (at job creation); only meaningful when biweekly |
| | `timesheetMonthlyStartDay` | `Int` | default `1`; 1-28 |
| | `timesheetFormat` | `String` | `"csv"` \| `"text"` \| `"both"` (default) |
| | `timesheetIncludeEarnings` / `timesheetIncludeNotes` / `timesheetIncludeTimes` | `Boolean` | all default `true` |
| | `roundingEnabled` | `Boolean` | default `false` |
| | `roundingMode` | `String` | `"up"` \| `"down"` \| `"nearest"` (default) |
| | `roundingIncrementMinutes` | `Int` | default `15`; one of 5/10/15/20/30/60/120 |
| | `createdAt` / `updatedAt` | `DateTime` | `updatedAt` is Prisma's `@updatedAt` — server-set on every write, and the field sync pulls by |
| | `deletedAt` | `DateTime?` | soft delete (tombstone) — see sync protocol |
| **RateTier** | `id` | `String` (uuid) | primary key, **client-generated** |
| | `jobId` | `String` | FK → Job, cascade delete |
| | `name` | `String` | e.g. `"Standard"`, `"Holiday"` |
| | `isDefault` | `Boolean` | default `false`; the "Standard" tier created with the job is the only one set `true` |
| | `archived` | `Boolean` | default `false` |
| | `createdAt` / `updatedAt` / `deletedAt` | | same semantics as Job |
| **RateVersion** | `id` | `String` (uuid) | primary key, **client-generated** |
| | `tierId` | `String` | FK → RateTier, cascade delete |
| | `hourlyRateCents` | `Int` | integer cents to avoid float rounding |
| | `effectiveFrom` | `DateTime` | when this rate started applying |
| | `createdAt` / `updatedAt` / `deletedAt` | | same semantics as Job |
| **Shift** | `id` | `String` (uuid) | primary key, **client-generated** |
| | `userId` | `String` | FK → User, cascade delete |
| | `jobId` | `String` | FK → Job, cascade delete |
| | `rateTierId` | `String?` | FK → RateTier, `SET NULL` on tier delete; `null` = job's default tier |
| | `clockIn` | `DateTime` | |
| | `clockOut` | `DateTime?` | `null` while open |
| | `notes` | `String?` | free text, editable from the History screen |
| | `createdAt` / `updatedAt` / `deletedAt` | | same semantics as Job |
| **Break** | `id` | `String` (uuid) | primary key, **client-generated** |
| | `shiftId` | `String` | FK → Shift, cascade delete |
| | `start` | `DateTime` | |
| | `end` | `DateTime?` | `null` while open |
| | `createdAt` / `updatedAt` / `deletedAt` | | same semantics as Job |
| **Manager** | `id` | `String` (uuid) | primary key, **client-generated** |
| | `userId` | `String` | FK → User, cascade delete |
| | `name` | `String` | |
| | `email` | `String` | |
| | `archived` | `Boolean` | default `false` |
| | `createdAt` / `updatedAt` / `deletedAt` | | same semantics as Job |
| **JobManager** | `id` | `String` (uuid) | primary key, **client-generated** |
| | `jobId` | `String` | FK → Job, cascade delete |
| | `managerId` | `String` | FK → Manager, cascade delete |
| | `createdAt` / `updatedAt` / `deletedAt` | | same semantics as Job |

Indexes: `Job`, `Shift`, and `Manager` are indexed on `(userId, updatedAt)` (the sync pull
query's access pattern); `RateTier` on `(jobId, updatedAt)`; `RateVersion` on `(tierId,
effectiveFrom)`; `Shift` also on `jobId` and `rateTierId`; `Break` on `(shiftId,
updatedAt)`; `JobManager` on `(jobId, updatedAt)` and `managerId`.

Note `RateTier`, `RateVersion`, `Break`, and `JobManager` have no `userId` column —
ownership is checked transitively through their parent(s) (`Job` for tiers, a tier's `Job`
for versions, `Shift` for breaks, `JobManager`'s own `jobId` *and* `managerId` must both
resolve to rows this user owns) — see the `upsertOwned*` helpers in
`server/src/routes/sync.ts`.

## Client schema (SQLite)

Source of truth: [`app/src/db/schema.ts`](../app/src/db/schema.ts). Column names are
`snake_case` (raw SQL) where the server/TypeScript types are `camelCase`; the mapping
functions live in `app/src/db/database.ts` (`rowToJob`, `rowToRateTier`,
`rowToRateVersion`, `rowToShift`, `rowToBreak`).

**`jobs`**, **`rate_tiers`**, **`rate_versions`**, **`shifts`**, **`breaks`**, **`managers`**,
**`job_managers`** mirror the server tables above one-for-one (same fields, `snake_case`
names, `TEXT` for all dates/timestamps as ISO-8601 strings, `INTEGER` 0/1 for booleans).
There is no `userId` column client-side — the local database only ever holds one
signed-in user's data, so it's implicit.

The schema evolves via numbered migrations tracked in SQLite's built-in `PRAGMA
user_version` (`runMigrations` in `database.ts`) — the same idea as
`server/prisma/migrations`, just without a dedicated CLI. `jobs.hourly_rate_cents`, from
before rate tiers existed, is left in the table unused rather than dropped (SQLite's
column-drop support varies by bundled version, and there's nothing to gain locally from
removing it) — new code must never read or write it.

Two extra tables exist only on the client, for sync bookkeeping:

#### `pending_changes`

```sql
CREATE TABLE pending_changes (
  entity_type TEXT NOT NULL,   -- 'job' | 'rateTier' | 'rateVersion' | 'shift' | 'break' | 'manager' | 'jobManager'
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

`app/src/types.ts` defines the client-side shape (`Job`, `RateTier`, `RateVersion`,
`Shift`, `Break`, `Manager`, `JobManager`, `EntityType`, `PendingOp`) used throughout the
app and by the sync client. These intentionally match the server's JSON response shape
field-for-field (Prisma's `Date` fields serialize to ISO strings over HTTP, which is
exactly what the client stores), so `app/src/sync/sync.ts` can push/pull without a
translation layer beyond `snake_case`/`camelCase` mapping.
