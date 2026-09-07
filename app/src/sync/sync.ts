import {
  clearPendingChanges,
  getPendingChanges,
  getRawBreak,
  getRawJob,
  getRawShift,
  getSyncCursor,
  setSyncCursor,
  upsertLocalBreak,
  upsertLocalJob,
  upsertLocalShift,
} from "../db/database";
import { dbEvents } from "../lib/events";
import type { Break, Job, Shift } from "../types";
import { pullChanges, pushChanges, type PushPayload } from "./api";

function jobFromRow(row: any): Job {
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
function shiftFromRow(row: any): Shift {
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
function breakFromRow(row: any): Break {
  return { id: row.id, shiftId: row.shift_id, start: row.start, end: row.end, updatedAt: row.updated_at, deletedAt: row.deleted_at };
}

let syncing = false;

// Pushes every locally-pending change, then pulls anything newer from the server and
// merges it into the local mirror. Safe to call opportunistically (app foreground,
// after a mutation, on a timer, or from a manual "Sync now" button) since it's a no-op
// when there's nothing pending and nothing new.
export async function synchronize(): Promise<{ pushed: number; pulled: number }> {
  if (syncing) return { pushed: 0, pulled: 0 };
  syncing = true;
  try {
    const pending = await getPendingChanges();
    const payload: PushPayload = { jobs: [], shifts: [], breaks: [], deletedJobIds: [], deletedShiftIds: [], deletedBreakIds: [] };
    const applied: { entityType: "job" | "shift" | "break"; entityId: string }[] = [];

    for (const change of pending) {
      applied.push({ entityType: change.entityType, entityId: change.entityId });
      if (change.op === "delete") {
        if (change.entityType === "job") payload.deletedJobIds.push(change.entityId);
        if (change.entityType === "shift") payload.deletedShiftIds.push(change.entityId);
        if (change.entityType === "break") payload.deletedBreakIds.push(change.entityId);
        continue;
      }
      if (change.entityType === "job") {
        const row = await getRawJob(change.entityId);
        if (row) payload.jobs.push(jobFromRow(row));
      } else if (change.entityType === "shift") {
        const row = await getRawShift(change.entityId);
        if (row) payload.shifts.push(shiftFromRow(row));
      } else {
        const row = await getRawBreak(change.entityId);
        if (row) payload.breaks.push(breakFromRow(row));
      }
    }

    const hasPush =
      payload.jobs.length ||
      payload.shifts.length ||
      payload.breaks.length ||
      payload.deletedJobIds.length ||
      payload.deletedShiftIds.length ||
      payload.deletedBreakIds.length;

    if (hasPush) {
      await pushChanges(payload);
      await clearPendingChanges(applied);
    }

    const cursor = await getSyncCursor();
    const pulled = await pullChanges(cursor);
    for (const job of pulled.jobs) await upsertLocalJob(job);
    for (const shift of pulled.shifts) await upsertLocalShift(shift);
    for (const brk of pulled.breaks) await upsertLocalBreak(brk);
    await setSyncCursor(pulled.serverTimestamp);

    const pulledCount = pulled.jobs.length + pulled.shifts.length + pulled.breaks.length;
    if (hasPush || pulledCount) dbEvents.emit();
    return { pushed: applied.length, pulled: pulledCount };
  } finally {
    syncing = false;
  }
}
