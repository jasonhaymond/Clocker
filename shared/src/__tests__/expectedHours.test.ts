import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateWeeklyProgress } from "../expectedHours";
import { makeJob, makeShift } from "./testFixtures";

// See pay.test.ts's comment on `at()` — same reasoning, local-Date-constructed so the
// calendar day (and therefore week grouping) is stable regardless of the runner's
// timezone. Jan 5, 2026 is a Monday.
function at(day: number, hour: number): string {
  return new Date(2026, 0, day, hour, 0, 0).toISOString();
}

// An open shift's contribution to worked time comes from rounding.ts's
// roundedWorkedMillis, which reads the REAL Date.now() for an open shift, not any
// injectable clock — so any test involving an open shift needs fake timers pinning "now"
// to the same fixture-relative instant used elsewhere in that test.
afterEach(() => {
  vi.useRealTimers();
});

describe("calculateWeeklyProgress", () => {
  it("returns null when the job has no weekly hours target", () => {
    const job = makeJob({ expectedWeeklyHours: null });
    const result = calculateWeeklyProgress({ job, shifts: [], breaksByShift: {}, now: new Date(2026, 0, 5, 12) });
    expect(result).toBeNull();
  });

  it("reports remaining minutes under target from a closed shift", () => {
    const job = makeJob({ expectedWeeklyHours: 40, expectedHoursWeekStartDay: 1 });
    const shift = makeShift({ jobId: job.id, clockIn: at(5, 9), clockOut: at(5, 17) }); // 8h, closed
    const result = calculateWeeklyProgress({ job, shifts: [shift], breaksByShift: {}, now: new Date(2026, 0, 5, 18) })!;

    expect(result.workedMinutes).toBe(480); // 8h
    expect(result.remainingMinutes).toBe(1920); // 40h - 8h
    expect(result.overMinutes).toBe(0);
    expect(result.expectedClockOut).toBeNull(); // no open shift to project from
  });

  it("reports over-target minutes once worked time exceeds the target, with remaining at zero", () => {
    const job = makeJob({ expectedWeeklyHours: 8, expectedHoursWeekStartDay: 1 });
    const shift = makeShift({ jobId: job.id, clockIn: at(5, 9), clockOut: at(5, 19) }); // 10h, closed
    const result = calculateWeeklyProgress({ job, shifts: [shift], breaksByShift: {}, now: new Date(2026, 0, 5, 20) })!;

    expect(result.workedMinutes).toBe(600); // 10h
    expect(result.remainingMinutes).toBe(0);
    expect(result.overMinutes).toBe(120); // 2h over
  });

  it("excludes manually-flagged overtime shifts from the weekly total entirely", () => {
    const job = makeJob({ expectedWeeklyHours: 40, expectedHoursWeekStartDay: 1 });
    const normal = makeShift({ id: "normal", jobId: job.id, clockIn: at(5, 9), clockOut: at(5, 17) }); // 8h
    const overtime = makeShift({ id: "ot", jobId: job.id, clockIn: at(6, 9), clockOut: at(6, 13), isOvertime: true }); // 4h, flagged
    const result = calculateWeeklyProgress({ job, shifts: [normal, overtime], breaksByShift: {}, now: new Date(2026, 0, 6, 18) })!;

    // Only the normal 8h shift should count — the flagged one contributes nothing.
    expect(result.workedMinutes).toBe(480);
  });

  it("excludes shifts outside the target week", () => {
    const job = makeJob({ expectedWeeklyHours: 40, expectedHoursWeekStartDay: 1 });
    const thisWeek = makeShift({ id: "this-week", jobId: job.id, clockIn: at(5, 9), clockOut: at(5, 17) });
    const lastWeek = makeShift({ id: "last-week", jobId: job.id, clockIn: at(1, 9), clockOut: at(1, 17) }); // the prior Thursday
    const result = calculateWeeklyProgress({ job, shifts: [thisWeek, lastWeek], breaksByShift: {}, now: new Date(2026, 0, 5, 18) })!;

    expect(result.workedMinutes).toBe(480); // only this week's shift
  });

  it("projects expected clock-out from now, for a shift already under way", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 5, 13, 0, 0)); // 4h into a shift that started at 9am
    const job = makeJob({ expectedWeeklyHours: 8, expectedHoursWeekStartDay: 1 });
    const shift = makeShift({ jobId: job.id, clockIn: at(5, 9), clockOut: null });
    const result = calculateWeeklyProgress({ job, shifts: [shift], breaksByShift: {} })!;

    expect(result.workedMinutes).toBe(240); // 4h so far
    expect(result.remainingMinutes).toBe(240); // 4h left of an 8h target
    // Projected from "now" (1pm) + 4h remaining = 5pm.
    expect(result.expectedClockOut?.toISOString()).toBe(at(5, 17));
  });

  it("projects expected clock-out from the shift's own clock-in when it hasn't started yet", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 5, 18, 0, 0)); // now, before a shift scheduled for later tonight
    const job = makeJob({ expectedWeeklyHours: 4, expectedHoursWeekStartDay: 1 });
    const shift = makeShift({ jobId: job.id, clockIn: at(5, 21), clockOut: null }); // starts at 9pm, 3 hours from "now"

    const result = calculateWeeklyProgress({ job, shifts: [shift], breaksByShift: {} })!;

    expect(result.workedMinutes).toBe(0); // hasn't started — no worked time yet
    expect(result.remainingMinutes).toBe(240); // full 4h target still ahead
    // Projected from the shift's own clock-in (9pm), not "now" (6pm) — projecting from
    // "now" would show a clock-out earlier than the shift even starts.
    expect(result.expectedClockOut?.toISOString()).toBe(at(6, 1)); // 9pm + 4h = 1am the next day
  });
});
