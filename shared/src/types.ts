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
  // Optional weekly hours target for this job — null disables the feature entirely (no
  // "remaining hours"/"expected clock-out" shown anywhere for this job). Deliberately a
  // simple independent week (expectedHoursWeekStartDay), not tied to this job's own
  // timesheetPeriodType/timesheetWeekStartDay — a monthly-pay job can still have a weekly
  // hours target, and the two concepts shouldn't have to agree on what "a week" means.
  expectedWeeklyHours: number | null;
  expectedHoursWeekStartDay: number; // 0=Sun..6=Sat
  // Location-based clock in/out (mobile only — see app/src/lib/locationTracking.ts). A
  // job has no location until locationLatitude/Longitude are set; locationAwarenessEnabled
  // prompts to clock in/out on arrival/departure, autoClockInOutEnabled does it silently
  // and requires locationAwarenessEnabled to also be true (it's a stronger version of the
  // same geofence, not an independent setting).
  locationAwarenessEnabled: boolean;
  autoClockInOutEnabled: boolean;
  locationLatitude: number | null;
  locationLongitude: number | null;
  locationRadiusMeters: number | null;
  // "Forgot to clock out" reminder (mobile only — see app/src/lib/staleShiftReminder.ts).
  // How many continuous hours an open shift on this job can run before a reminder
  // notification fires; null disables the reminder entirely for this job. New jobs
  // default to 8.
  staleShiftReminderHours: number | null;
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
  // A manual override, independent of the job's automatic weekly-threshold overtime (see
  // calculateShiftPay): marks this specific shift as overtime regardless of whether the
  // threshold's been crossed, at the job's overtimeMultiplier if one's configured — and
  // excludes it entirely from calculateWeeklyProgress's worked-hours total, since overtime
  // worked isn't what a weekly hours *target* is meant to track.
  isOvertime: boolean;
  // Manually entered — see docs/user-guide.md. Distance driven for this shift, in miles.
  // Not automatically tracked (no GPS-based distance calculation); null means not entered.
  mileage: number | null;
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
