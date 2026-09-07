import * as Crypto from "expo-crypto";
import * as SQLite from "expo-sqlite";
import { dbEvents } from "../lib/events";
import type { Break, EntityType, Job, PendingOp, Shift } from "../types";
import { SCHEMA_SQL } from "./schema";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync("clocker.db").then(async (db) => {
      await db.execAsync(SCHEMA_SQL);
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
    hourlyRateCents: row.hourly_rate_cents,
    archived: !!row.archived,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function rowToShift(row: any): Shift {
  return {
    id: row.id,
    jobId: row.job_id,
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

export async function createJob(input: {
  name: string;
  colorHex: string;
  hourlyRateCents: number | null;
}): Promise<Job> {
  const db = await getDb();
  const id = newId();
  const updatedAt = nowIso();
  await db.runAsync(
    "INSERT INTO jobs (id, name, color_hex, hourly_rate_cents, archived, updated_at) VALUES (?, ?, ?, ?, 0, ?)",
    [id, input.name, input.colorHex, input.hourlyRateCents, updatedAt],
  );
  await markPending("job", id, "upsert");
  dbEvents.emit();
  return { id, name: input.name, colorHex: input.colorHex, hourlyRateCents: input.hourlyRateCents, archived: false, updatedAt, deletedAt: null };
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

// ---- Shifts ----

export async function getOpenShift(): Promise<Shift | null> {
  const db = await getDb();
  const row = await db.getFirstAsync(
    "SELECT * FROM shifts WHERE clock_out IS NULL AND deleted_at IS NULL ORDER BY clock_in DESC LIMIT 1",
  );
  return row ? rowToShift(row) : null;
}

export async function clockIn(jobId: string): Promise<Shift> {
  const existingOpen = await getOpenShift();
  if (existingOpen) {
    throw new Error("A shift is already clocked in. Clock out first.");
  }
  const db = await getDb();
  const id = newId();
  const updatedAt = nowIso();
  await db.runAsync(
    "INSERT INTO shifts (id, job_id, clock_in, updated_at) VALUES (?, ?, ?, ?)",
    [id, jobId, updatedAt, updatedAt],
  );
  await markPending("shift", id, "upsert");
  dbEvents.emit();
  return { id, jobId, clockIn: updatedAt, clockOut: null, notes: null, updatedAt, deletedAt: null };
}

export async function clockOut(shiftId: string): Promise<void> {
  const openBreak = await getOpenBreak(shiftId);
  if (openBreak) {
    await endBreak(openBreak.id);
  }
  const db = await getDb();
  const clockOutAt = nowIso();
  await db.runAsync("UPDATE shifts SET clock_out = ?, updated_at = ? WHERE id = ?", [clockOutAt, clockOutAt, shiftId]);
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

export async function startBreak(shiftId: string): Promise<Break> {
  const db = await getDb();
  const id = newId();
  const start = nowIso();
  await db.runAsync("INSERT INTO breaks (id, shift_id, start, updated_at) VALUES (?, ?, ?, ?)", [id, shiftId, start, start]);
  await markPending("break", id, "upsert");
  dbEvents.emit();
  return { id, shiftId, start, end: null, updatedAt: start, deletedAt: null };
}

export async function endBreak(breakId: string): Promise<void> {
  const db = await getDb();
  const end = nowIso();
  await db.runAsync("UPDATE breaks SET end = ?, updated_at = ? WHERE id = ?", [end, end, breakId]);
  await markPending("break", breakId, "upsert");
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
export async function getRawShift(id: string) {
  const db = await getDb();
  return db.getFirstAsync("SELECT * FROM shifts WHERE id = ?", [id]);
}
export async function getRawBreak(id: string) {
  const db = await getDb();
  return db.getFirstAsync("SELECT * FROM breaks WHERE id = ?", [id]);
}

export async function upsertLocalJob(job: Job): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO jobs (id, name, color_hex, hourly_rate_cents, archived, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET name = excluded.name, color_hex = excluded.color_hex, hourly_rate_cents = excluded.hourly_rate_cents, archived = excluded.archived, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at",
    [job.id, job.name, job.colorHex, job.hourlyRateCents, job.archived ? 1 : 0, job.updatedAt, job.deletedAt],
  );
}

export async function upsertLocalShift(shift: Shift): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO shifts (id, job_id, clock_in, clock_out, notes, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET job_id = excluded.job_id, clock_in = excluded.clock_in, clock_out = excluded.clock_out, notes = excluded.notes, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at",
    [shift.id, shift.jobId, shift.clockIn, shift.clockOut, shift.notes, shift.updatedAt, shift.deletedAt],
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
