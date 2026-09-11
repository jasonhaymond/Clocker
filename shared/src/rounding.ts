import type { Break, Job, Shift } from "./types";
import { breakMillis } from "./time";

export const ROUNDING_INCREMENT_MINUTES = [5, 10, 15, 20, 30, 60, 120] as const;

function roundToIncrement(ms: number, incrementMs: number, mode: Job["roundingMode"]): number {
  if (mode === "up") return Math.ceil(ms / incrementMs) * incrementMs;
  if (mode === "down") return Math.floor(ms / incrementMs) * incrementMs;
  return Math.round(ms / incrementMs) * incrementMs;
}

// Worked time for a shift, honoring the job's optional time-entry rounding: when enabled,
// the clock-in and clock-out (or "now", for a still-open shift) are each rounded to the
// job's configured increment/mode before the duration is computed — the same way a
// physical timeclock rounds punches — so a shift's *stored* clock-in/out are never
// altered, only what's used for computing hours and pay (History totals, Export,
// Timesheets — every "hours" figure except the live elapsed-time stopwatch on the Clock
// screen, which deliberately uses raw workedMillis instead: a real-time ticking display
// shouldn't jump between rounding increments). Breaks are never rounded, only the shift's
// own start/end-or-now.
export function roundedWorkedMillis(shift: Shift, breaks: Break[], job: Job | undefined): number {
  if (!job?.roundingEnabled) {
    const end = shift.clockOut ? new Date(shift.clockOut).getTime() : Date.now();
    return Math.max(0, end - new Date(shift.clockIn).getTime() - breakMillis(breaks));
  }
  const incrementMs = job.roundingIncrementMinutes * 60_000;
  const clockInMs = roundToIncrement(new Date(shift.clockIn).getTime(), incrementMs, job.roundingMode);
  const end = shift.clockOut ? new Date(shift.clockOut).getTime() : Date.now();
  const endMs = roundToIncrement(end, incrementMs, job.roundingMode);
  return Math.max(0, endMs - clockInMs - breakMillis(breaks));
}
