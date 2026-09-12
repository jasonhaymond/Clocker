import { groupRowsByJob, type Break, type Job, type ParsedImportRow, type RateTier, type RateVersion, type Shift } from "@clocker/shared";
import { pushChanges } from "../api";

// Same palette JobsScreen/JobEditor already cycle through for a new job's default color.
const PALETTE = ["#1d4ed8", "#b91c1c", "#16a34a", "#d97706", "#7c3aed", "#0891b2"];

function newId(): string {
  return crypto.randomUUID();
}

export interface ImportSummary {
  jobsCreated: number;
  shiftsImported: number;
  shiftsSkipped: number;
}

// Builds every new Job/RateTier/RateVersion/Shift/Break record client-side and pushes
// them all in one batch (`pushChanges` already accepts full arrays — see api.ts) rather
// than routing through the one-row-at-a-time store actions (`clockIn`/`clockOut`/...),
// each of which triggers its own network round-trip AND a full `refresh()` re-pull of the
// entire dataset (store.tsx's own comment explains why). Fine for a single interactive
// click; not for a few hundred rows from an import file.
export async function runImport(rows: ParsedImportRow[], existingJobs: Job[], existingShifts: Shift[]): Promise<ImportSummary> {
  const jobIdByName = new Map<string, string>();
  for (const j of existingJobs) if (!jobIdByName.has(j.name)) jobIdByName.set(j.name, j.id);

  const now = new Date().toISOString();
  const newJobs: Job[] = [];
  const newTiers: RateTier[] = [];
  const newVersions: RateVersion[] = [];
  let colorIndex = 0;

  for (const [jobName, group] of groupRowsByJob(rows)) {
    if (jobIdByName.has(jobName)) continue;
    const jobId = newId();
    const tierId = newId();
    newJobs.push({
      id: jobId,
      name: jobName,
      colorHex: PALETTE[colorIndex % PALETTE.length],
      archived: false,
      overtimeMultiplier: null,
      overtimeWeeklyThresholdHours: null,
      timesheetPeriodType: "weekly",
      timesheetWeekStartDay: 1,
      timesheetBiweeklyAnchor: now,
      timesheetMonthlyStartDay: 1,
      timesheetFormat: "both",
      timesheetIncludeEarnings: true,
      timesheetIncludeNotes: true,
      timesheetIncludeTimes: true,
      roundingEnabled: false,
      roundingMode: "nearest",
      roundingIncrementMinutes: 15,
      promptForNotesOnClockOut: false,
      expectedWeeklyHours: null,
      expectedHoursWeekStartDay: 1,
      updatedAt: now,
      deletedAt: null,
    });
    newTiers.push({ id: tierId, jobId, name: "Standard", isDefault: true, archived: false, updatedAt: now, deletedAt: null });
    if (group.rateCents != null) {
      newVersions.push({
        id: newId(),
        tierId,
        hourlyRateCents: group.rateCents,
        effectiveFrom: group.earliestClockIn,
        updatedAt: now,
        deletedAt: null,
      });
    }
    jobIdByName.set(jobName, jobId);
    colorIndex++;
  }

  // Dedup key: same job + same clock-in timestamp already exists — makes re-importing
  // the same file (or one that overlaps a previous import) safe rather than doubling
  // every shift it has in common with what's already there.
  const existingShiftKeys = new Set(existingShifts.map((s) => `${s.jobId}|${s.clockIn}`));
  const newShifts: Shift[] = [];
  const newBreaks: Break[] = [];
  let shiftsSkipped = 0;

  for (const row of rows) {
    const jobId = jobIdByName.get(row.jobName)!;
    const key = `${jobId}|${row.clockIn}`;
    if (existingShiftKeys.has(key)) {
      shiftsSkipped++;
      continue;
    }
    existingShiftKeys.add(key); // also guards against a duplicate row within the same file
    const shiftId = newId();
    newShifts.push({
      id: shiftId,
      jobId,
      rateTierId: null,
      clockIn: row.clockIn,
      clockOut: row.clockOut,
      notes: row.notes,
      updatedAt: now,
      deletedAt: null,
    });
    for (const brk of row.breaks) {
      newBreaks.push({ id: newId(), shiftId, start: brk.start, end: brk.end, updatedAt: now, deletedAt: null });
    }
  }

  await pushChanges({ jobs: newJobs, rateTiers: newTiers, rateVersions: newVersions, shifts: newShifts, breaks: newBreaks });

  return { jobsCreated: newJobs.length, shiftsImported: newShifts.length, shiftsSkipped };
}
