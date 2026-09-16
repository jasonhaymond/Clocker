# Data Model

This is technical reference material for anyone writing code against Clocker's database —
skip it if you're just using or deploying the app (see the [documentation
index](./README.md) for the guide that's actually for you).

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
  free-text comment, editable from the History screen. `isOvertime` is a manual per-shift
  override, editable from the shift editor (History) — independent of the job's automatic
  weekly-threshold overtime (see [Rate history](#rate-history-tiers-and-overtime)): every
  hour of a flagged shift is paid as overtime regardless of the threshold, and the shift is
  excluded entirely from `calculateWeeklyProgress`'s weekly hours target
  (`shared/src/expectedHours.ts`), since overtime worked isn't what that target tracks.
  `mileage` is manually entered (no GPS-based tracking) — miles driven for this shift,
  `null` if not entered; shown on the shift editor and totaled per job on Export/
  Timesheets output and a generated invoice's line items.
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

Every job carries its own Timesheets-tab configuration (and its rounding/notes-prompt
settings) directly as fields on the `Job` row — this is real job data other devices need
to see the same way, so it's synced like everything else on `Job` rather than living in a
device-local preference/AsyncStorage. Different jobs can legitimately pay on different
schedules, report to different people, or want a note prompt on one but not another,
which is why this is per-job rather than one app-wide setting.

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
  `shared/src/rounding.ts`'s `roundedWorkedMillis` rounds a shift's clock-in and its
  clock-out (or "now", for a still-open shift) to the nearest increment before computing
  worked time — the same way a physical timeclock rounds punches. The shift's stored
  `clockIn`/`clockOut` are never altered; rounding only affects computed hours/pay, applied
  consistently everywhere an hours figure is shown (`groupShiftsByJob` in
  `exportFormat.ts` for Export/Timesheets, and `HistoryScreen`'s own duration
  calculations) — the one deliberate exception is the live elapsed-time stopwatch on the
  Clock screen, which uses raw `workedMillis` instead so it doesn't visibly jump between
  rounding increments. Breaks are never rounded, only the shift's own start/end-or-now.
- **Prompt for notes on clock out** — `promptForNotesOnClockOut` (per job, default
  `false`). Used to be a single device-local preference covering every job (never
  synced); moved here since different jobs legitimately want different behavior.
- **Weekly hours target** — `expectedWeeklyHours` (per job, `null` disables the feature)
  and `expectedHoursWeekStartDay` (0=Sun..6=Sat, default Monday). `shared/src/expectedHours.ts`'s
  `calculateWeeklyProgress` sums this job's `roundedWorkedMillis` across the current week
  (including a currently open shift, counted up to "now") and shows "remaining hours" and,
  while clocked in, an "expected clock-out" time (now + however much is left, assuming no
  further breaks) on the Clock screen. Deliberately its own simple week, independent of
  the job's `timesheetPeriodType`/`timesheetWeekStartDay` — a monthly-pay job can still
  have a weekly hours target without the two concepts having to agree on what "a week" is.

## Location-based clock in/out (per job, mobile only)

Also fields on `Job` (synced the same way as everything above), but acted on only by the
phone app — see [`app/src/lib/locationTracking.ts`](../app/src/lib/locationTracking.ts).
A browser tab has no way to run code while closed or in the background, so the web client
only ever carries these fields through sync untouched; it has no UI for them.

- **The geofence itself** — `locationLatitude`/`locationLongitude` (both `null` until a
  location is set for this job) and `locationRadiusMeters`. Set from the phone app's
  "Use My Current Location" button or the map picker, both ending at a fixed radius choice
  (100/250/500/1000m).
- **Location awareness** — `locationAwarenessEnabled` (per job, default `false`). Refuses
  to turn on (`updateJobLocationAwareness` throws) unless the job already has a location
  set. When on, entering or leaving the geofence — even with the app closed, via the OS's
  native region-monitoring, not continuous polling — queues a local "clock in?"/"clock
  out?" prompt shown the next time the app is foregrounded, plus a tap-to-open
  notification. Turning it off also forces `autoClockInOutEnabled` off (below).
- **Auto clock in/out** — `autoClockInOutEnabled` (per job, default `false`). Refuses to
  turn on unless `locationAwarenessEnabled` is already `true` for this job — it's a
  stronger version of the same geofence, not an independent setting. When on, the same
  arrival/departure event clocks in/out directly instead of queuing a prompt, then posts a
  plain confirmation notification.

Neither setting causes any continuous location trail to be stored anywhere — only the one
geofence (a single point + radius) you set for the job, synced like the rest of that job's
data.

## "Forgot to clock out" reminders (per job, mobile only)

`Job.staleShiftReminderHours` (`Float?`/`number | null`, defaults to `8` at the database
level so existing jobs get this too, not just newly created ones) — how many continuous
hours an open shift on this job can run before a reminder notification fires; `null`
disables it for that job. See
[`app/src/lib/staleShiftReminder.ts`](../app/src/lib/staleShiftReminder.ts): scheduled as
a single OS-level trigger notification at clock-in time (cancelled at clock-out), not a
periodic check — it fires even with the app fully closed, with no reliance on the app's
JS thread staying alive. The notification id it schedules is local-only bookkeeping (an
Android/iOS notification id from one device is meaningless anywhere else), kept in
AsyncStorage rather than as a synced field.

## Invoices

A generated, immutable snapshot — a separate `Invoice` table (not a field on `Job`/
`Shift`), created via `POST /invoices` and viewable by anyone with its link via
`GET /invoices/:shareToken`, no Clocker account needed (the same trust model as a payment-
link URL — `shareToken`, a random UUID, is the link's only credential). See
[`server/src/routes/invoices.ts`](../server/src/routes/invoices.ts).

Line items and totals are computed once, server-side, at generation time from the job's
shifts/rates in exactly the same way Export/Timesheets compute them
(`shared/src/exportFormat.ts`'s `groupShiftsByJob`) — then frozen into the `lineItems`
JSON column. A rate change or an edited shift afterward doesn't retroactively alter an
invoice that's already been generated or sent, the same way a real invoice wouldn't. The
job's name/color are snapshotted too (`jobName`/`jobColorHex`), since the job itself could
be renamed, recolored, or deleted later without changing an invoice already sent out.

The public view (`GET /invoices/:shareToken`) renders a plain HTML page with a "Download
PDF" link; the PDF itself (`GET /invoices/:shareToken/pdf`) is built with `pdfkit`
directly (drawing primitives, no headless browser) — deliberately avoiding a Chromium
dependency, which would meaningfully bloat every self-hoster's Docker image for a
one-page document this simple.

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
| | `tokenVersion` | `Int` | default `0`; embedded in every issued JWT, bumped on password change/"log out everywhere" to revoke every previously-issued token — see [`api-reference.md`](./api-reference.md#authentication) |
| | `passwordResetTokenHash` | `String?` | sha256 of a random reset token (never the raw token — same principle as `passwordHash`); `null` when there's no in-flight reset request |
| | `passwordResetExpiresAt` | `DateTime?` | 1 hour after `/auth/forgot-password` issues a token; `null` alongside the hash above |
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
| | `promptForNotesOnClockOut` | `Boolean` | default `false` |
| | `expectedWeeklyHours` | `Float?` | `null` disables the weekly-hours-target feature for this job |
| | `expectedHoursWeekStartDay` | `Int` | default `1` (Monday); 0=Sun..6=Sat |
| | `locationAwarenessEnabled` | `Boolean` | default `false`; requires a location set |
| | `autoClockInOutEnabled` | `Boolean` | default `false`; requires `locationAwarenessEnabled` |
| | `locationLatitude` / `locationLongitude` | `Float?` | both `null` until a location is set for this job |
| | `locationRadiusMeters` | `Float?` | e.g. `250`; `null` until a location is set |
| | `staleShiftReminderHours` | `Float?` | default `8`; `null` disables the "forgot to clock out" reminder for this job |
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
| | `isOvertime` | `Boolean` | default `false`; manual override — see the Shift bullet above |
| | `mileage` | `Float?` | manually entered; `null` if not entered |
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
| **Invoice** | `id` | `String` (uuid) | primary key, **server-generated** — unlike everything else in this table, invoices are created by the server (`POST /invoices`), not synced from a client |
| | `userId` | `String` | FK → User, cascade delete |
| | `jobId` | `String` | FK → Job, cascade delete |
| | `shareToken` | `String` | unique, server-generated (a random UUID); the public link's only credential |
| | `periodStart` / `periodEnd` | `DateTime` | the range invoiced |
| | `rangeLabel` | `String` | e.g. `"Sep 8 - 14, 2026"`, shown on the invoice |
| | `jobName` / `jobColorHex` | `String` | snapshotted at generation time — doesn't change if the job is later renamed/recolored/deleted |
| | `lineItems` | `Json` | array of `{ date, hours, cents, notes }`, frozen at generation time |
| | `totalHours` | `Float` | |
| | `totalCents` | `Int` | |
| | `createdAt` | `DateTime` | no `updatedAt`/`deletedAt` — an invoice is immutable once created, never edited or soft-deleted |

Indexes: `Job`, `Shift`, and `Manager` are indexed on `(userId, updatedAt)` (the sync pull
query's access pattern); `RateTier` on `(jobId, updatedAt)`; `RateVersion` on `(tierId,
effectiveFrom)`; `Shift` also on `jobId` and `rateTierId`; `Break` on `(shiftId,
updatedAt)`; `JobManager` on `(jobId, updatedAt)` and `managerId`; `Invoice` on
`(userId, jobId)` and uniquely on `shareToken`.

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
signed-in user's data, so it's implicit. `Invoice` has no client-side table at all — it's
never synced, only created/viewed via direct API calls (`POST /invoices`, `GET
/invoices?jobId=`) from whichever client generated it.

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
