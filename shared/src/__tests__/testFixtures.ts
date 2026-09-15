// Minimal-but-complete factories for the four entities most of shared/'s calculation
// logic operates on. Every field a test doesn't care about gets a reasonable, boring
// default, so a test only needs to spell out the handful of fields it's actually
// exercising — the same reasoning `createJob`/`createRateTier` apply on the app side.
import type { Break, Job, RateTier, RateVersion, Shift } from "../types";

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: nextId("job"),
    name: "Test Job",
    colorHex: "#3f568d",
    archived: false,
    overtimeMultiplier: null,
    overtimeWeeklyThresholdHours: null,
    timesheetPeriodType: "weekly",
    timesheetWeekStartDay: 1,
    timesheetBiweeklyAnchor: "2026-01-05T00:00:00.000Z",
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
    locationAwarenessEnabled: false,
    autoClockInOutEnabled: false,
    locationLatitude: null,
    locationLongitude: null,
    locationRadiusMeters: null,
    staleShiftReminderHours: 8,
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

export function makeTier(overrides: Partial<RateTier> = {}): RateTier {
  return {
    id: nextId("tier"),
    jobId: "job-1",
    name: "Standard",
    isDefault: true,
    archived: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

export function makeVersion(overrides: Partial<RateVersion> = {}): RateVersion {
  return {
    id: nextId("version"),
    tierId: "tier-1",
    hourlyRateCents: 2000,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

export function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: nextId("shift"),
    jobId: "job-1",
    rateTierId: null,
    clockIn: "2026-01-05T09:00:00.000Z",
    clockOut: "2026-01-05T17:00:00.000Z",
    notes: null,
    isOvertime: false,
    mileage: null,
    updatedAt: "2026-01-05T17:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

export function makeBreak(overrides: Partial<Break> = {}): Break {
  return {
    id: nextId("break"),
    shiftId: "shift-1",
    start: "2026-01-05T12:00:00.000Z",
    end: "2026-01-05T12:30:00.000Z",
    updatedAt: "2026-01-05T12:30:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}
