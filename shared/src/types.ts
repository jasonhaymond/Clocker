export type TimesheetPeriodType = "weekly" | "biweekly" | "monthly";
export type TimesheetExportFormat = "csv" | "text" | "both";
export type RoundingMode = "up" | "down" | "nearest";

export interface Job {
  id: string;
  name: string;
  colorHex: string;
  archived: boolean;
  // Overtime is calculated per ISO week (Mon-Sun) across all of this job's shifts that
  // week. Null multiplier/threshold means overtime is disabled for this job.
  overtimeMultiplier: number | null;
  overtimeWeeklyThresholdHours: number | null;
  // Timesheet tab settings — each job has its own recurring pay period and submission
  // preferences, since different jobs can pay on different schedules and report to
  // different people. See app/src/lib/timesheetPeriods.ts.
  timesheetPeriodType: TimesheetPeriodType;
  timesheetWeekStartDay: number; // 0=Sun..6=Sat
  timesheetBiweeklyAnchor: string;
  timesheetMonthlyStartDay: number; // 1-28
  timesheetFormat: TimesheetExportFormat;
  timesheetIncludeEarnings: boolean;
  timesheetIncludeNotes: boolean;
  timesheetIncludeTimes: boolean;
  // Time entry rounding — optional, per job. See app/src/lib/rounding.ts.
  roundingEnabled: boolean;
  roundingMode: RoundingMode;
  roundingIncrementMinutes: number;
  // Per-job: prompt for an optional note right after clocking out of this job. Used to be
  // a single device-local preference covering every job; different jobs legitimately want
  // different behavior, so it moved here alongside the job's other settings.
  promptForNotesOnClockOut: boolean;
  updatedAt: string;
  deletedAt: string | null;
}

// A named rate under a job (most jobs have exactly one, called "Standard"). Lets a job
// have more than one rate (e.g. "Standard" vs "Holiday") and lets a shift record which
// one it was worked under.
export interface RateTier {
  id: string;
  jobId: string;
  name: string;
  isDefault: boolean;
  archived: boolean;
  updatedAt: string;
  deletedAt: string | null;
}

// A rate tier's value, effective from a point in time. Changing a tier's rate creates a
// new version rather than editing the old one, so a past shift's pay is always computed
// from the version that was active when it happened. See app/src/lib/pay.ts.
export interface RateVersion {
  id: string;
  tierId: string;
  hourlyRateCents: number;
  effectiveFrom: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Shift {
  id: string;
  jobId: string;
  // Which of the job's rate tiers this shift was worked under. Null means "the job's
  // default tier," resolved at pay-calculation time rather than frozen at clock-in.
  rateTierId: string | null;
  clockIn: string;
  clockOut: string | null;
  notes: string | null;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Break {
  id: string;
  shiftId: string;
  start: string;
  end: string | null;
  updatedAt: string;
  deletedAt: string | null;
}

// A saved recipient for the "export to email" flow.
export interface Manager {
  id: string;
  name: string;
  email: string;
  archived: boolean;
  updatedAt: string;
  deletedAt: string | null;
}

// Assigns a Manager as a timesheet-submission recipient for a specific job. A plain join
// row — a manager can receive timesheets for several jobs, and a job can submit to
// several managers.
export interface JobManager {
  id: string;
  jobId: string;
  managerId: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type EntityType = "job" | "rateTier" | "rateVersion" | "shift" | "break" | "manager" | "jobManager";
export type PendingOp = "upsert" | "delete";
