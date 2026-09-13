import type { Break, Job, Shift } from "./types";
import { addDays } from "./time";
import { mostRecentWeekStart } from "./timesheetPeriods";
import { roundedWorkedMillis } from "./rounding";

export interface WeeklyProgress {
  targetMinutes: number;
  workedMinutes: number;
  remainingMinutes: number;
  // How far past the target worked time already is, once it's been reached — 0 while
  // still under target (remainingMinutes is the meaningful one then). The two are
  // deliberately mutually exclusive rather than one of them going negative, so a caller
  // can render "X left" vs "X over" without doing its own sign-checking arithmetic.
  overMinutes: number;
  // Only set when this job currently has an open shift — projecting a clock-out time
  // without one to project from wouldn't mean anything.
  expectedClockOut: Date | null;
}

// A job's progress toward its own expectedWeeklyHours target, for the week (per
// expectedHoursWeekStartDay) containing `now`. Every shift's worked time is computed via
// roundedWorkedMillis — the same job-specific rounding rules used everywhere else hours
// are shown — including the currently open shift, if any, counted up to `now`.
//
// expectedClockOut assumes no further breaks beyond what's already been taken: it's
// "if you took no more breaks from here, this is when you'd hit your target," not a
// prediction of your actual break habits. Projected from `now` for a normal already-
// under-way shift (clockIn in the past) — but from the shift's own clockIn instead when
// that's still in the future (e.g. a "Start At..." clock-in for later today), since no
// work happens between now and then; projecting from `now` in that case would show an
// expected clock-out earlier than the shift has even started.
export function calculateWeeklyProgress(params: {
  job: Job;
  shifts: Shift[];
  breaksByShift: Record<string, Break[]>;
  now?: Date;
}): WeeklyProgress | null {
  const { job, shifts, breaksByShift } = params;
  if (job.expectedWeeklyHours == null) return null;
  const now = params.now ?? new Date();

  const weekStart = mostRecentWeekStart(now, job.expectedHoursWeekStartDay);
  const weekEnd = addDays(weekStart, 7);

  let workedMs = 0;
  let openShift: Shift | null = null;
  for (const shift of shifts) {
    const clockInMs = new Date(shift.clockIn).getTime();
    if (clockInMs < weekStart.getTime() || clockInMs >= weekEnd.getTime()) continue;
    // Overtime worked isn't what a weekly hours *target* is meant to track — excluded
    // from the total entirely, and never the shift expectedClockOut projects from either
    // (projecting "when you'd hit your target" from a shift that doesn't count toward it
    // wouldn't mean anything).
    if (shift.isOvertime) continue;
    workedMs += roundedWorkedMillis(shift, breaksByShift[shift.id] ?? [], job);
    if (!shift.clockOut) openShift = shift;
  }

  const targetMs = job.expectedWeeklyHours * 3_600_000;
  const remainingMs = Math.max(0, targetMs - workedMs);
  const overMs = Math.max(0, workedMs - targetMs);

  return {
    targetMinutes: targetMs / 60_000,
    workedMinutes: workedMs / 60_000,
    remainingMinutes: remainingMs / 60_000,
    overMinutes: overMs / 60_000,
    expectedClockOut: openShift
      ? new Date(Math.max(now.getTime(), new Date(openShift.clockIn).getTime()) + remainingMs)
      : null,
  };
}
