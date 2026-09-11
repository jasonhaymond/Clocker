import * as Crypto from "expo-crypto";
import * as SQLite from "expo-sqlite";
import { dbEvents } from "../lib/events";
import type { Break, EntityType, Job, JobManager, Manager, PendingOp, RateTier, RateVersion, Shift } from "@clocker/shared";
import { MIGRATIONS, SCHEMA_VERSION } from "./schema";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

// Brings a database from whatever version it's currently at up to SCHEMA_VERSION by
// running each migration it hasn't seen yet, tracked via SQLite's built-in
// `PRAGMA user_version` (a plain integer SQLite reserves exactly for this purpose — no
// separate bookkeeping table needed). A fresh database starts at 0 and runs every
// migration in order, including the baseline.
async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  const currentVersion = row?.user_version ?? 0;
  for (let version = currentVersion; version < SCHEMA_VERSION; version++) {
    await db.execAsync(MIGRATIONS[version]);
    await db.execAsync(`PRAGMA user_version = ${version + 1}`);
  }
}

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync("clocker.db").then(async (db) => {
      await runMigrations(db);
      return db;
    });
  }
  return dbPromise;
}

export function newId(): string {
  return Crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

async function markPending(entityType: EntityType, entityId: string, op: PendingOp) {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO pending_changes (entity_type, entity_id, op) VALUES (?, ?, ?) " +
      "ON CONFLICT(entity_type, entity_id) DO UPDATE SET op = excluded.op",
    [entityType, entityId, op],
  );
}

function rowToJob(row: any): Job {
  return {
    id: row.id,
    name: row.name,
    colorHex: row.color_hex,
    archived: !!row.archived,
    overtimeMultiplier: row.overtime_multiplier,
    overtimeWeeklyThresholdHours: row.overtime_weekly_threshold_hours,
    timesheetPeriodType: row.timesheet_period_type,
    timesheetWeekStartDay: row.timesheet_week_start_day,
    timesheetBiweeklyAnchor: row.timesheet_biweekly_anchor,
    timesheetMonthlyStartDay: row.timesheet_monthly_start_day,
    timesheetFormat: row.timesheet_format,
    timesheetIncludeEarnings: !!row.timesheet_include_earnings,
    timesheetIncludeNotes: !!row.timesheet_include_notes,
    timesheetIncludeTimes: !!row.timesheet_include_times,
    roundingEnabled: !!row.rounding_enabled,
    roundingMode: row.rounding_mode,
    roundingIncrementMinutes: row.rounding_increment_minutes,
    promptForNotesOnClockOut: !!row.prompt_for_notes_on_clock_out,
    expectedWeeklyHours: row.expected_weekly_hours,
    expectedHoursWeekStartDay: row.expected_hours_week_start_day,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function rowToJobManager(row: any): JobManager {
  return { id: row.id, jobId: row.job_id, managerId: row.manager_id, updatedAt: row.updated_at, deletedAt: row.deleted_at };
}

function rowToRateTier(row: any): RateTier {
  return {
    id: row.id,
    jobId: row.job_id,
    name: row.name,
    isDefault: !!row.is_default,
    archived: !!row.archived,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function rowToRateVersion(row: any): RateVersion {
  return {
    id: row.id,
    tierId: row.tier_id,
    hourlyRateCents: row.hourly_rate_cents,
    effectiveFrom: row.effective_from,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function rowToShift(row: any): Shift {
  return {
    id: row.id,
    jobId: row.job_id,
    rateTierId: row.rate_tier_id,
    clockIn: row.clock_in,
    clockOut: row.clock_out,
    notes: row.notes,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function rowToBreak(row: any): Break {
  return {
    id: row.id,
    shiftId: row.shift_id,
    start: row.start,
    end: row.end,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function rowToManager(row: any): Manager {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    archived: !!row.archived,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

// ---- Jobs ----

export async function listJobs(includeArchived = false): Promise<Job[]> {
  const db = await getDb();
  const rows = await db.getAllAsync(
    includeArchived
      ? "SELECT * FROM jobs WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE"
      : "SELECT * FROM jobs WHERE deleted_at IS NULL AND archived = 0 ORDER BY name COLLATE NOCASE",
  );
  return rows.map(rowToJob);
}

export async function getJob(id: string): Promise<Job | null> {
  const db = await getDb();
  const row = await db.getFirstAsync("SELECT * FROM jobs WHERE id = ?", [id]);
  return row ? rowToJob(row) : null;
}

// Creates a job and its default "Standard" rate tier (every job always has one, even if
// no rate is set yet — later rate entry just adds a version to this tier). Passing
// `initialHourlyRateCents` also adds that tier's first rate version, effective now.
export async function createJob(input: {
  name: string;
  colorHex: string;
  initialHourlyRateCents: number | null;
}): Promise<Job> {
  const db = await getDb();
  const id = newId();
  const updatedAt = nowIso();
  await db.runAsync("INSERT INTO jobs (id, name, color_hex, archived, updated_at) VALUES (?, ?, ?, 0, ?)", [
    id,
    input.name,
    input.colorHex,
    updatedAt,
  ]);
  await markPending("job", id, "upsert");

  await createRateTier(id, "Standard", input.initialHourlyRateCents, true);

  dbEvents.emit();
  // Re-read rather than hand-assembling the return value, so it reflects the table's own
  // SQL defaults for every column this function doesn't explicitly set (timesheet period/
  // submission settings, rounding) without duplicating them here.
  return (await getJob(id))!;
}

export async function updateJobDetails(id: string, patch: { name?: string; colorHex?: string }): Promise<void> {
  const db = await getDb();
  const current = await getJob(id);
  if (!current) return;
  const name = patch.name ?? current.name;
  const colorHex = patch.colorHex ?? current.colorHex;
  await db.runAsync("UPDATE jobs SET name = ?, color_hex = ?, updated_at = ? WHERE id = ?", [name, colorHex, nowIso(), id]);
  await markPending("job", id, "upsert");
  dbEvents.emit();
}

export async function updateJobOvertime(
  id: string,
  patch: { overtimeMultiplier: number | null; overtimeWeeklyThresholdHours: number | null },
): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE jobs SET overtime_multiplier = ?, overtime_weekly_threshold_hours = ?, updated_at = ? WHERE id = ?", [
    patch.overtimeMultiplier,
    patch.overtimeWeeklyThresholdHours,
    nowIso(),
    id,
  ]);
  await markPending("job", id, "upsert");
  dbEvents.emit();
}

export async function updateJobTimesheetSettings(
  id: string,
  patch: Partial<
    Pick<
      Job,
      | "timesheetPeriodType"
      | "timesheetWeekStartDay"
      | "timesheetBiweeklyAnchor"
      | "timesheetMonthlyStartDay"
      | "timesheetFormat"
      | "timesheetIncludeEarnings"
      | "timesheetIncludeNotes"
      | "timesheetIncludeTimes"
    >
  >,
): Promise<void> {
  const db = await getDb();
  const current = await getJob(id);
  if (!current) return;
  const merged = { ...current, ...patch };
  await db.runAsync(
    "UPDATE jobs SET timesheet_period_type = ?, timesheet_week_start_day = ?, timesheet_biweekly_anchor = ?, " +
      "timesheet_monthly_start_day = ?, timesheet_format = ?, timesheet_include_earnings = ?, timesheet_include_notes = ?, " +
      "timesheet_include_times = ?, updated_at = ? WHERE id = ?",
    [
      merged.timesheetPeriodType,
      merged.timesheetWeekStartDay,
      merged.timesheetBiweeklyAnchor,
      merged.timesheetMonthlyStartDay,
      merged.timesheetFormat,
      merged.timesheetIncludeEarnings ? 1 : 0,
      merged.timesheetIncludeNotes ? 1 : 0,
      merged.timesheetIncludeTimes ? 1 : 0,
      nowIso(),
      id,
    ],
  );
  await markPending("job", id, "upsert");
  dbEvents.emit();
}

export async function updateJobRounding(
  id: string,
  patch: { roundingEnabled: boolean; roundingMode: Job["roundingMode"]; roundingIncrementMinutes: number },
): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE jobs SET rounding_enabled = ?, rounding_mode = ?, rounding_increment_minutes = ?, updated_at = ? WHERE id = ?", [
    patch.roundingEnabled ? 1 : 0,
    patch.roundingMode,
    patch.roundingIncrementMinutes,
    nowIso(),
    id,
  ]);
  await markPending("job", id, "upsert");
  dbEvents.emit();
}

export async function updateJobPromptForNotes(id: string, promptForNotesOnClockOut: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE jobs SET prompt_for_notes_on_clock_out = ?, updated_at = ? WHERE id = ?", [
    promptForNotesOnClockOut ? 1 : 0,
    nowIso(),
    id,
  ]);
  await markPending("job", id, "upsert");
  dbEvents.emit();
}

export async function updateJobExpectedHours(
  id: string,
  patch: { expectedWeeklyHours: number | null; expectedHoursWeekStartDay: number },
): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE jobs SET expected_weekly_hours = ?, expected_hours_week_start_day = ?, updated_at = ? WHERE id = ?", [
    patch.expectedWeeklyHours,
    patch.expectedHoursWeekStartDay,
    nowIso(),
    id,
  ]);
  await markPending("job", id, "upsert");
  dbEvents.emit();
}

export async function setJobArchived(id: string, archived: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE jobs SET archived = ?, updated_at = ? WHERE id = ?", [archived ? 1 : 0, nowIso(), id]);
  await markPending("job", id, "upsert");
  dbEvents.emit();
}

export async function deleteJob(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE jobs SET deleted_at = ? WHERE id = ?", [nowIso(), id]);
  await markPending("job", id, "delete");
  dbEvents.emit();
}

// ---- Rate tiers & rate history ----

export async function listRateTiers(jobId: string, includeArchived = true): Promise<RateTier[]> {
  const db = await getDb();
  const rows = await db.getAllAsync(
    includeArchived
      ? "SELECT * FROM rate_tiers WHERE job_id = ? AND deleted_at IS NULL ORDER BY is_default DESC, name COLLATE NOCASE"
      : "SELECT * FROM rate_tiers WHERE job_id = ? AND deleted_at IS NULL AND archived = 0 ORDER BY is_default DESC, name COLLATE NOCASE",
    [jobId],
  );
  return rows.map(rowToRateTier);
}

export async function listRateTiersForJobs(jobIds: string[]): Promise<RateTier[]> {
  if (jobIds.length === 0) return [];
  const db = await getDb();
  const placeholders = jobIds.map(() => "?").join(",");
  const rows = await db.getAllAsync(`SELECT * FROM rate_tiers WHERE deleted_at IS NULL AND job_id IN (${placeholders})`, jobIds);
  return rows.map(rowToRateTier);
}

// Creates a rate tier under a job, optionally with its first rate version effective now.
export async function createRateTier(
  jobId: string,
  name: string,
  initialHourlyRateCents: number | null,
  isDefault = false,
): Promise<RateTier> {
  const db = await getDb();
  const id = newId();
  const updatedAt = nowIso();
  await db.runAsync("INSERT INTO rate_tiers (id, job_id, name, is_default, archived, updated_at) VALUES (?, ?, ?, ?, 0, ?)", [
    id,
    jobId,
    name,
    isDefault ? 1 : 0,
    updatedAt,
  ]);
  await markPending("rateTier", id, "upsert");
  if (initialHourlyRateCents != null) {
    await addRateVersion(id, initialHourlyRateCents, updatedAt);
  }
  dbEvents.emit();
  return { id, jobId, name, isDefault, archived: false, updatedAt, deletedAt: null };
}

export async function setRateTierArchived(id: string, archived: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE rate_tiers SET archived = ?, updated_at = ? WHERE id = ?", [archived ? 1 : 0, nowIso(), id]);
  await markPending("rateTier", id, "upsert");
  dbEvents.emit();
}

export async function deleteRateTier(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE rate_tiers SET deleted_at = ? WHERE id = ?", [nowIso(), id]);
  await markPending("rateTier", id, "delete");
  dbEvents.emit();
}

// Rates are never edited in place — changing a rate adds a new version effective from
// `effectiveFrom` (defaults to now), so shifts that already happened keep the rate that
// was actually active at the time. See docs/data-model.md and app/src/lib/pay.ts.
export async function addRateVersion(tierId: string, hourlyRateCents: number, effectiveFrom?: string): Promise<RateVersion> {
  const db = await getDb();
  const id = newId();
  const updatedAt = nowIso();
  const effective = effectiveFrom ?? updatedAt;
  await db.runAsync("INSERT INTO rate_versions (id, tier_id, hourly_rate_cents, effective_from, updated_at) VALUES (?, ?, ?, ?, ?)", [
    id,
    tierId,
    hourlyRateCents,
    effective,
    updatedAt,
  ]);
  await markPending("rateVersion", id, "upsert");
  dbEvents.emit();
  return { id, tierId, hourlyRateCents, effectiveFrom: effective, updatedAt, deletedAt: null };
}

export async function listRateVersionsForTier(tierId: string): Promise<RateVersion[]> {
  const db = await getDb();
  const rows = await db.getAllAsync(
    "SELECT * FROM rate_versions WHERE tier_id = ? AND deleted_at IS NULL ORDER BY effective_from DESC",
    [tierId],
  );
  return rows.map(rowToRateVersion);
}

export async function listRateVersionsForTiers(tierIds: string[]): Promise<RateVersion[]> {
  if (tierIds.length === 0) return [];
  const db = await getDb();
  const placeholders = tierIds.map(() => "?").join(",");
  const rows = await db.getAllAsync(
    `SELECT * FROM rate_versions WHERE deleted_at IS NULL AND tier_id IN (${placeholders})`,
    tierIds,
  );
  return rows.map(rowToRateVersion);
}

// ---- Shifts ----

// Every shift still open app-wide — clocking into multiple jobs at once is allowed (see
// getOpenShiftForJob below for the one constraint that remains: a job can't have two
// open shifts of its own at the same time).
export async function getOpenShifts(): Promise<Shift[]> {
  const db = await getDb();
  const rows = await db.getAllAsync("SELECT * FROM shifts WHERE clock_out IS NULL AND deleted_at IS NULL ORDER BY clock_in ASC");
  return rows.map(rowToShift);
}

export async function getOpenShiftForJob(jobId: string): Promise<Shift | null> {
  const db = await getDb();
  const row = await db.getFirstAsync(
    "SELECT * FROM shifts WHERE job_id = ? AND clock_out IS NULL AND deleted_at IS NULL ORDER BY clock_in DESC LIMIT 1",
    [jobId],
  );
  return row ? rowToShift(row) : null;
}

// `clockInTime` defaults to now but can be backdated (or postdated) — e.g. "Clock In
// At..." for a forgotten clock-in. Only one open shift per job is enforced; a different
// job can have its own open shift at the same time.
export async function clockIn(jobId: string, rateTierId: string | null = null, clockInTime?: string): Promise<Shift> {
  const existingForJob = await getOpenShiftForJob(jobId);
  if (existingForJob) {
    throw new Error("Already clocked in to this job. Clock out first.");
  }
  const db = await getDb();
  const id = newId();
  const clockInAt = clockInTime ?? nowIso();
  const updatedAt = nowIso();
  await db.runAsync("INSERT INTO shifts (id, job_id, rate_tier_id, clock_in, updated_at) VALUES (?, ?, ?, ?, ?)", [
    id,
    jobId,
    rateTierId,
    clockInAt,
    updatedAt,
  ]);
  await markPending("shift", id, "upsert");
  dbEvents.emit();
  return { id, jobId, rateTierId, clockIn: clockInAt, clockOut: null, notes: null, updatedAt, deletedAt: null };
}

// `clockOutTime` defaults to now but can be set explicitly ("Clock Out At...").
export async function clockOut(shiftId: string, clockOutTime?: string): Promise<void> {
  const openBreak = await getOpenBreak(shiftId);
  if (openBreak) {
    await endBreak(openBreak.id, clockOutTime);
  }
  const db = await getDb();
  const clockOutAt = clockOutTime ?? nowIso();
  await db.runAsync("UPDATE shifts SET clock_out = ?, updated_at = ? WHERE id = ?", [clockOutAt, nowIso(), shiftId]);
  await markPending("shift", shiftId, "upsert");
  dbEvents.emit();
}

export async function updateShiftTimes(
  shiftId: string,
  patch: { clockIn?: string; clockOut?: string | null; notes?: string | null },
): Promise<void> {
  const db = await getDb();
  const current = await db.getFirstAsync("SELECT * FROM shifts WHERE id = ?", [shiftId]);
  if (!current) return;
  const merged = { ...rowToShift(current), ...patch };
  await db.runAsync("UPDATE shifts SET clock_in = ?, clock_out = ?, notes = ?, updated_at = ? WHERE id = ?", [
    merged.clockIn,
    merged.clockOut,
    merged.notes,
    nowIso(),
    shiftId,
  ]);
  await markPending("shift", shiftId, "upsert");
  dbEvents.emit();
}

export async function deleteShift(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE shifts SET deleted_at = ? WHERE id = ?", [nowIso(), id]);
  await markPending("shift", id, "delete");
  dbEvents.emit();
}

export async function listShiftsInRange(startIso: string, endIsoExclusive: string, jobId?: string): Promise<Shift[]> {
  const db = await getDb();
  const rows = jobId
    ? await db.getAllAsync(
        "SELECT * FROM shifts WHERE deleted_at IS NULL AND job_id = ? AND clock_in >= ? AND clock_in < ? ORDER BY clock_in DESC",
        [jobId, startIso, endIsoExclusive],
      )
    : await db.getAllAsync(
        "SELECT * FROM shifts WHERE deleted_at IS NULL AND clock_in >= ? AND clock_in < ? ORDER BY clock_in DESC",
        [startIso, endIsoExclusive],
      );
  return rows.map(rowToShift);
}

// ---- Breaks ----

export async function getOpenBreak(shiftId: string): Promise<Break | null> {
  const db = await getDb();
  const row = await db.getFirstAsync(
    "SELECT * FROM breaks WHERE shift_id = ? AND end IS NULL AND deleted_at IS NULL ORDER BY start DESC LIMIT 1",
    [shiftId],
  );
  return row ? rowToBreak(row) : null;
}

// `startTime` defaults to now but can be backdated ("Start Break At...").
export async function startBreak(shiftId: string, startTime?: string): Promise<Break> {
  const db = await getDb();
  const id = newId();
  const start = startTime ?? nowIso();
  const updatedAt = nowIso();
  await db.runAsync("INSERT INTO breaks (id, shift_id, start, updated_at) VALUES (?, ?, ?, ?)", [id, shiftId, start, updatedAt]);
  await markPending("break", id, "upsert");
  dbEvents.emit();
  return { id, shiftId, start, end: null, updatedAt, deletedAt: null };
}

// `endTime` lets a custom clock-out (in the past) close a still-open break at the same
// moment, rather than leaving it stamped with "now" — which could otherwise end up after
// the shift's own clock-out.
export async function endBreak(breakId: string, endTime?: string): Promise<void> {
  const db = await getDb();
  const end = endTime ?? nowIso();
  await db.runAsync("UPDATE breaks SET end = ?, updated_at = ? WHERE id = ?", [end, nowIso(), breakId]);
  await markPending("break", breakId, "upsert");
  dbEvents.emit();
}

// General correction, unlike startBreak/endBreak's "now, or a specific moment as it
// happens" framing — used by the shift editor to fix up a break's times after the fact.
export async function updateBreakTimes(breakId: string, patch: { start?: string; end?: string | null }): Promise<void> {
  const db = await getDb();
  const current = await db.getFirstAsync("SELECT * FROM breaks WHERE id = ?", [breakId]);
  if (!current) return;
  const merged = { ...rowToBreak(current), ...patch };
  await db.runAsync("UPDATE breaks SET start = ?, end = ?, updated_at = ? WHERE id = ?", [merged.start, merged.end, nowIso(), breakId]);
  await markPending("break", breakId, "upsert");
  dbEvents.emit();
}

export async function deleteBreak(breakId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE breaks SET deleted_at = ? WHERE id = ?", [nowIso(), breakId]);
  await markPending("break", breakId, "delete");
  dbEvents.emit();
}

export async function listBreaksForShift(shiftId: string): Promise<Break[]> {
  const db = await getDb();
  const rows = await db.getAllAsync("SELECT * FROM breaks WHERE shift_id = ? AND deleted_at IS NULL ORDER BY start", [shiftId]);
  return rows.map(rowToBreak);
}

export async function listBreaksForShifts(shiftIds: string[]): Promise<Break[]> {
  if (shiftIds.length === 0) return [];
  const db = await getDb();
  const placeholders = shiftIds.map(() => "?").join(",");
  const rows = await db.getAllAsync(
    `SELECT * FROM breaks WHERE deleted_at IS NULL AND shift_id IN (${placeholders}) ORDER BY start`,
    shiftIds,
  );
  return rows.map(rowToBreak);
}

// ---- Managers ----

export async function listManagers(includeArchived = true): Promise<Manager[]> {
  const db = await getDb();
  const rows = await db.getAllAsync(
    includeArchived
      ? "SELECT * FROM managers WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE"
      : "SELECT * FROM managers WHERE deleted_at IS NULL AND archived = 0 ORDER BY name COLLATE NOCASE",
  );
  return rows.map(rowToManager);
}

export async function listManagersForIds(ids: string[]): Promise<Manager[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  const placeholders = ids.map(() => "?").join(",");
  const rows = await db.getAllAsync(`SELECT * FROM managers WHERE deleted_at IS NULL AND id IN (${placeholders})`, ids);
  return rows.map(rowToManager);
}

export async function createManager(input: { name: string; email: string }): Promise<Manager> {
  const db = await getDb();
  const id = newId();
  const updatedAt = nowIso();
  await db.runAsync("INSERT INTO managers (id, name, email, archived, updated_at) VALUES (?, ?, ?, 0, ?)", [
    id,
    input.name,
    input.email,
    updatedAt,
  ]);
  await markPending("manager", id, "upsert");
  dbEvents.emit();
  return { id, name: input.name, email: input.email, archived: false, updatedAt, deletedAt: null };
}

export async function updateManager(id: string, patch: { name?: string; email?: string }): Promise<void> {
  const db = await getDb();
  const current = await db.getFirstAsync("SELECT * FROM managers WHERE id = ?", [id]);
  if (!current) return;
  const merged = { ...rowToManager(current), ...patch };
  await db.runAsync("UPDATE managers SET name = ?, email = ?, updated_at = ? WHERE id = ?", [merged.name, merged.email, nowIso(), id]);
  await markPending("manager", id, "upsert");
  dbEvents.emit();
}

export async function setManagerArchived(id: string, archived: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE managers SET archived = ?, updated_at = ? WHERE id = ?", [archived ? 1 : 0, nowIso(), id]);
  await markPending("manager", id, "upsert");
  dbEvents.emit();
}

export async function deleteManager(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE managers SET deleted_at = ? WHERE id = ?", [nowIso(), id]);
  await markPending("manager", id, "delete");
  dbEvents.emit();
}

// ---- Job <-> Manager assignments (which managers a job's timesheets submit to) ----

export async function listJobManagers(jobId: string): Promise<JobManager[]> {
  const db = await getDb();
  const rows = await db.getAllAsync("SELECT * FROM job_managers WHERE job_id = ? AND deleted_at IS NULL", [jobId]);
  return rows.map(rowToJobManager);
}

export async function addJobManager(jobId: string, managerId: string): Promise<JobManager> {
  const db = await getDb();
  const id = newId();
  const updatedAt = nowIso();
  await db.runAsync("INSERT INTO job_managers (id, job_id, manager_id, updated_at) VALUES (?, ?, ?, ?)", [
    id,
    jobId,
    managerId,
    updatedAt,
  ]);
  await markPending("jobManager", id, "upsert");
  dbEvents.emit();
  return { id, jobId, managerId, updatedAt, deletedAt: null };
}

export async function removeJobManager(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE job_managers SET deleted_at = ? WHERE id = ?", [nowIso(), id]);
  await markPending("jobManager", id, "delete");
  dbEvents.emit();
}

// ---- Sync helpers (used by src/sync/sync.ts) ----

export async function getPendingChanges(): Promise<{ entityType: EntityType; entityId: string; op: PendingOp }[]> {
  const db = await getDb();
  const rows = await db.getAllAsync("SELECT * FROM pending_changes");
  return rows.map((r: any) => ({ entityType: r.entity_type, entityId: r.entity_id, op: r.op }));
}

export async function clearPendingChanges(entries: { entityType: EntityType; entityId: string }[]): Promise<void> {
  if (entries.length === 0) return;
  const db = await getDb();
  for (const e of entries) {
    await db.runAsync("DELETE FROM pending_changes WHERE entity_type = ? AND entity_id = ?", [e.entityType, e.entityId]);
  }
}

export async function getRawJob(id: string) {
  const db = await getDb();
  return db.getFirstAsync("SELECT * FROM jobs WHERE id = ?", [id]);
}
export async function getRawRateTier(id: string) {
  const db = await getDb();
  return db.getFirstAsync("SELECT * FROM rate_tiers WHERE id = ?", [id]);
}
export async function getRawRateVersion(id: string) {
  const db = await getDb();
  return db.getFirstAsync("SELECT * FROM rate_versions WHERE id = ?", [id]);
}
export async function getRawShift(id: string) {
  const db = await getDb();
  return db.getFirstAsync("SELECT * FROM shifts WHERE id = ?", [id]);
}
export async function getRawBreak(id: string) {
  const db = await getDb();
  return db.getFirstAsync("SELECT * FROM breaks WHERE id = ?", [id]);
}
export async function getRawManager(id: string) {
  const db = await getDb();
  return db.getFirstAsync("SELECT * FROM managers WHERE id = ?", [id]);
}
export async function getRawJobManager(id: string) {
  const db = await getDb();
  return db.getFirstAsync("SELECT * FROM job_managers WHERE id = ?", [id]);
}

export async function upsertLocalJob(job: Job): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO jobs (id, name, color_hex, archived, overtime_multiplier, overtime_weekly_threshold_hours, " +
      "timesheet_period_type, timesheet_week_start_day, timesheet_biweekly_anchor, timesheet_monthly_start_day, " +
      "timesheet_format, timesheet_include_earnings, timesheet_include_notes, timesheet_include_times, " +
      "rounding_enabled, rounding_mode, rounding_increment_minutes, prompt_for_notes_on_clock_out, " +
      "expected_weekly_hours, expected_hours_week_start_day, updated_at, deleted_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET name = excluded.name, color_hex = excluded.color_hex, archived = excluded.archived, " +
      "overtime_multiplier = excluded.overtime_multiplier, overtime_weekly_threshold_hours = excluded.overtime_weekly_threshold_hours, " +
      "timesheet_period_type = excluded.timesheet_period_type, timesheet_week_start_day = excluded.timesheet_week_start_day, " +
      "timesheet_biweekly_anchor = excluded.timesheet_biweekly_anchor, timesheet_monthly_start_day = excluded.timesheet_monthly_start_day, " +
      "timesheet_format = excluded.timesheet_format, timesheet_include_earnings = excluded.timesheet_include_earnings, " +
      "timesheet_include_notes = excluded.timesheet_include_notes, timesheet_include_times = excluded.timesheet_include_times, " +
      "rounding_enabled = excluded.rounding_enabled, rounding_mode = excluded.rounding_mode, " +
      "rounding_increment_minutes = excluded.rounding_increment_minutes, " +
      "prompt_for_notes_on_clock_out = excluded.prompt_for_notes_on_clock_out, " +
      "expected_weekly_hours = excluded.expected_weekly_hours, " +
      "expected_hours_week_start_day = excluded.expected_hours_week_start_day, " +
      "updated_at = excluded.updated_at, deleted_at = excluded.deleted_at",
    [
      job.id,
      job.name,
      job.colorHex,
      job.archived ? 1 : 0,
      job.overtimeMultiplier,
      job.overtimeWeeklyThresholdHours,
      job.timesheetPeriodType,
      job.timesheetWeekStartDay,
      job.timesheetBiweeklyAnchor,
      job.timesheetMonthlyStartDay,
      job.timesheetFormat,
      job.timesheetIncludeEarnings ? 1 : 0,
      job.timesheetIncludeNotes ? 1 : 0,
      job.timesheetIncludeTimes ? 1 : 0,
      job.roundingEnabled ? 1 : 0,
      job.roundingMode,
      job.roundingIncrementMinutes,
      job.promptForNotesOnClockOut ? 1 : 0,
      job.expectedWeeklyHours,
      job.expectedHoursWeekStartDay,
      job.updatedAt,
      job.deletedAt,
    ],
  );
}

export async function upsertLocalRateTier(tier: RateTier): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO rate_tiers (id, job_id, name, is_default, archived, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET job_id = excluded.job_id, name = excluded.name, is_default = excluded.is_default, archived = excluded.archived, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at",
    [tier.id, tier.jobId, tier.name, tier.isDefault ? 1 : 0, tier.archived ? 1 : 0, tier.updatedAt, tier.deletedAt],
  );
}

export async function upsertLocalRateVersion(version: RateVersion): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO rate_versions (id, tier_id, hourly_rate_cents, effective_from, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET tier_id = excluded.tier_id, hourly_rate_cents = excluded.hourly_rate_cents, effective_from = excluded.effective_from, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at",
    [version.id, version.tierId, version.hourlyRateCents, version.effectiveFrom, version.updatedAt, version.deletedAt],
  );
}

export async function upsertLocalShift(shift: Shift): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO shifts (id, job_id, rate_tier_id, clock_in, clock_out, notes, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET job_id = excluded.job_id, rate_tier_id = excluded.rate_tier_id, clock_in = excluded.clock_in, clock_out = excluded.clock_out, notes = excluded.notes, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at",
    [shift.id, shift.jobId, shift.rateTierId, shift.clockIn, shift.clockOut, shift.notes, shift.updatedAt, shift.deletedAt],
  );
}

export async function upsertLocalBreak(brk: Break): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO breaks (id, shift_id, start, end, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET shift_id = excluded.shift_id, start = excluded.start, end = excluded.end, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at",
    [brk.id, brk.shiftId, brk.start, brk.end, brk.updatedAt, brk.deletedAt],
  );
}

export async function upsertLocalManager(manager: Manager): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO managers (id, name, email, archived, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email, archived = excluded.archived, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at",
    [manager.id, manager.name, manager.email, manager.archived ? 1 : 0, manager.updatedAt, manager.deletedAt],
  );
}

export async function upsertLocalJobManager(jm: JobManager): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO job_managers (id, job_id, manager_id, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET job_id = excluded.job_id, manager_id = excluded.manager_id, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at",
    [jm.id, jm.jobId, jm.managerId, jm.updatedAt, jm.deletedAt],
  );
}

export async function getSyncCursor(): Promise<string | null> {
  const db = await getDb();
  const row: any = await db.getFirstAsync("SELECT value FROM sync_state WHERE key = 'last_synced_at'");
  return row ? row.value : null;
}

export async function setSyncCursor(value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO sync_state (key, value) VALUES ('last_synced_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [value],
  );
}
