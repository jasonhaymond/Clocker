import { groupRowsByJob, type Job, type ParsedImportRow } from "@clocker/shared";
import { clockIn, clockOut, createJob, endBreak, listShiftsInRange, startBreak, updateShiftTimes } from "../db/database";

// Same palette JobsScreen/JobDetailModal already cycle through for a new job's default color.
const PALETTE = ["#1d4ed8", "#b91c1c", "#16a34a", "#d97706", "#7c3aed", "#0891b2"];

export interface ImportSummary {
  jobsCreated: number;
  shiftsImported: number;
  shiftsSkipped: number;
}

// Unlike web (which batches everything into one `pushChanges` call to avoid hundreds of
// network round-trips), this goes through the normal per-row SQLite functions in a
// sequential loop — local writes are fast enough that a few hundred of them complete in
// well under a second, and reusing `clockIn`/`clockOut`/`startBreak`/`endBreak` means
// every row gets the exact same pending-change/outbox bookkeeping a live clock-in already
// gets, for free, instead of a second hand-rolled insert path that could drift from it.
export async function runImport(
  rows: ParsedImportRow[],
  existingJobs: Job[],
  onProgress?: (done: number, total: number) => void,
): Promise<ImportSummary> {
  const jobIdByName = new Map<string, string>();
  for (const j of existingJobs) if (!jobIdByName.has(j.name)) jobIdByName.set(j.name, j.id);

  let jobsCreated = 0;
  let colorIndex = 0;
  for (const [jobName, group] of groupRowsByJob(rows)) {
    if (jobIdByName.has(jobName)) continue;
    const job = await createJob({
      name: jobName,
      colorHex: PALETTE[colorIndex % PALETTE.length],
      initialHourlyRateCents: group.rateCents,
      rateEffectiveFrom: group.earliestClockIn,
    });
    colorIndex++;
    jobIdByName.set(jobName, job.id);
    jobsCreated++;
  }

  // Mobile has no single in-memory "all shifts" list to dedup against (contrast with
  // web's already-loaded store.shifts) — fetch whatever already exists across the
  // imported file's own date span in one query instead.
  let existingShiftKeys = new Set<string>();
  if (rows.length > 0) {
    const minClockIn = rows.reduce((min, r) => (r.clockIn < min ? r.clockIn : min), rows[0].clockIn);
    const maxClockIn = rows.reduce((max, r) => (r.clockIn > max ? r.clockIn : max), rows[0].clockIn);
    const endExclusive = new Date(new Date(maxClockIn).getTime() + 1).toISOString();
    const existingShifts = await listShiftsInRange(minClockIn, endExclusive);
    existingShiftKeys = new Set(existingShifts.map((s) => `${s.jobId}|${s.clockIn}`));
  }

  let shiftsImported = 0;
  let shiftsSkipped = 0;
  const total = rows.length;
  let done = 0;
  for (const row of rows) {
    done++;
    onProgress?.(done, total);
    const jobId = jobIdByName.get(row.jobName)!;
    const key = `${jobId}|${row.clockIn}`;
    if (existingShiftKeys.has(key)) {
      shiftsSkipped++;
      continue;
    }
    existingShiftKeys.add(key); // also guards against a duplicate row within the same file

    const shift = await clockIn(jobId, null, row.clockIn);
    await clockOut(shift.id, row.clockOut);
    if (row.notes) await updateShiftTimes(shift.id, { notes: row.notes });
    for (const brk of row.breaks) {
      const b = await startBreak(shift.id, brk.start);
      await endBreak(b.id, brk.end);
    }
    shiftsImported++;
  }

  return { jobsCreated, shiftsImported, shiftsSkipped };
}
