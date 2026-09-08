export interface Job {
  id: string;
  name: string;
  colorHex: string;
  archived: boolean;
  // Overtime is calculated per ISO week (Mon-Sun) across all of this job's shifts that
  // week. Null multiplier/threshold means overtime is disabled for this job.
  overtimeMultiplier: number | null;
  overtimeWeeklyThresholdHours: number | null;
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

export type EntityType = "job" | "rateTier" | "rateVersion" | "shift" | "break";
export type PendingOp = "upsert" | "delete";
