import {
  clearPendingChanges,
  getPendingChanges,
  getRawBreak,
  getRawJob,
  getRawManager,
  getRawRateTier,
  getRawRateVersion,
  getRawShift,
  getSyncCursor,
  setSyncCursor,
  upsertLocalBreak,
  upsertLocalJob,
  upsertLocalManager,
  upsertLocalRateTier,
  upsertLocalRateVersion,
  upsertLocalShift,
} from "../db/database";
import { dbEvents } from "../lib/events";
import type { Break, Job, Manager, RateTier, RateVersion, Shift } from "../types";
import { pullChanges, pushChanges, type PushPayload } from "./api";

function jobFromRow(row: any): Job {
  return {
    id: row.id,
    name: row.name,
    colorHex: row.color_hex,
    archived: !!row.archived,
    overtimeMultiplier: row.overtime_multiplier,
    overtimeWeeklyThresholdHours: row.overtime_weekly_threshold_hours,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}
function rateTierFromRow(row: any): RateTier {
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
function rateVersionFromRow(row: any): RateVersion {
  return {
    id: row.id,
    tierId: row.tier_id,
    hourlyRateCents: row.hourly_rate_cents,
    effectiveFrom: row.effective_from,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}
function shiftFromRow(row: any): Shift {
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
function breakFromRow(row: any): Break {
  return { id: row.id, shiftId: row.shift_id, start: row.start, end: row.end, updatedAt: row.updated_at, deletedAt: row.deleted_at };
}
function managerFromRow(row: any): Manager {
  return { id: row.id, name: row.name, email: row.email, archived: !!row.archived, updatedAt: row.updated_at, deletedAt: row.deleted_at };
}

type SyncEntityType = "job" | "rateTier" | "rateVersion" | "shift" | "break" | "manager";

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
    const payload: PushPayload = {
      jobs: [],
      rateTiers: [],
      rateVersions: [],
      shifts: [],
      breaks: [],
      managers: [],
      deletedJobIds: [],
      deletedRateTierIds: [],
      deletedRateVersionIds: [],
      deletedShiftIds: [],
      deletedBreakIds: [],
      deletedManagerIds: [],
    };
    const applied: { entityType: SyncEntityType; entityId: string }[] = [];

    for (const change of pending) {
      applied.push({ entityType: change.entityType, entityId: change.entityId });
      if (change.op === "delete") {
        if (change.entityType === "job") payload.deletedJobIds.push(change.entityId);
        if (change.entityType === "rateTier") payload.deletedRateTierIds.push(change.entityId);
        if (change.entityType === "rateVersion") payload.deletedRateVersionIds.push(change.entityId);
        if (change.entityType === "shift") payload.deletedShiftIds.push(change.entityId);
        if (change.entityType === "break") payload.deletedBreakIds.push(change.entityId);
        if (change.entityType === "manager") payload.deletedManagerIds.push(change.entityId);
        continue;
      }
      if (change.entityType === "job") {
        const row = await getRawJob(change.entityId);
        if (row) payload.jobs.push(jobFromRow(row));
      } else if (change.entityType === "rateTier") {
        const row = await getRawRateTier(change.entityId);
        if (row) payload.rateTiers.push(rateTierFromRow(row));
      } else if (change.entityType === "rateVersion") {
        const row = await getRawRateVersion(change.entityId);
        if (row) payload.rateVersions.push(rateVersionFromRow(row));
      } else if (change.entityType === "shift") {
        const row = await getRawShift(change.entityId);
        if (row) payload.shifts.push(shiftFromRow(row));
      } else if (change.entityType === "break") {
        const row = await getRawBreak(change.entityId);
        if (row) payload.breaks.push(breakFromRow(row));
      } else {
        const row = await getRawManager(change.entityId);
        if (row) payload.managers.push(managerFromRow(row));
      }
    }

    const hasPush =
      payload.jobs.length ||
      payload.rateTiers.length ||
      payload.rateVersions.length ||
      payload.shifts.length ||
      payload.breaks.length ||
      payload.managers.length ||
      payload.deletedJobIds.length ||
      payload.deletedRateTierIds.length ||
      payload.deletedRateVersionIds.length ||
      payload.deletedShiftIds.length ||
      payload.deletedBreakIds.length ||
      payload.deletedManagerIds.length;

    if (hasPush) {
      await pushChanges(payload);
      await clearPendingChanges(applied);
    }

    const cursor = await getSyncCursor();
    const pulled = await pullChanges(cursor);
    for (const job of pulled.jobs) await upsertLocalJob(job);
    for (const tier of pulled.rateTiers) await upsertLocalRateTier(tier);
    for (const version of pulled.rateVersions) await upsertLocalRateVersion(version);
    for (const shift of pulled.shifts) await upsertLocalShift(shift);
    for (const brk of pulled.breaks) await upsertLocalBreak(brk);
    for (const manager of pulled.managers) await upsertLocalManager(manager);
    await setSyncCursor(pulled.serverTimestamp);

    const pulledCount =
      pulled.jobs.length +
      pulled.rateTiers.length +
      pulled.rateVersions.length +
      pulled.shifts.length +
      pulled.breaks.length +
      pulled.managers.length;
    if (hasPush || pulledCount) dbEvents.emit();
    return { pushed: applied.length, pulled: pulledCount };
  } finally {
    syncing = false;
  }
}
