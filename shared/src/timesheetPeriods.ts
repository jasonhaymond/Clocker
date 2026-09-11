import type { Job } from "./types";
import { addDays, startOfDay } from "./time";

export type PeriodType = "weekly" | "biweekly" | "monthly";

export interface PeriodSettings {
  periodType: PeriodType;
  // Day the week starts on for weekly/biweekly periods (0=Sun..6=Sat).
  weekStartDay: number;
  // A known period-start date, used only to fix which week of a pair is "week one" for
  // biweekly periods (weekly/monthly periods don't need an anchor — they're derived
  // from weekStartDay / monthlyStartDay alone).
  biweeklyAnchor: string;
  // Day of month a monthly period starts on (1-28, kept off the 29-31 range so every
  // month has that day).
  monthlyStartDay: number;
}

export interface Period {
  start: Date;
  end: Date; // exclusive
  label: string;
}

// Exported for reuse by expectedHours.ts, which needs the same "which week does this
// moment fall in, given an arbitrary start day" calculation but deliberately doesn't want
// to pull in the rest of the period-type system (biweekly/monthly aren't meaningful for a
// weekly hours target).
export function mostRecentWeekStart(date: Date, weekStartDay: number): Date {
  const d = startOfDay(date);
  const diff = (d.getDay() - weekStartDay + 7) % 7;
  return addDays(d, -diff);
}

function periodLabel(start: Date, end: Date): string {
  const endInclusive = addDays(end, -1);
  const sameMonth = start.getMonth() === endInclusive.getMonth() && start.getFullYear() === endInclusive.getFullYear();
  const startStr = start.toLocaleDateString([], { month: "short", day: "numeric" });
  const endStr = endInclusive.toLocaleDateString([], sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
  const year = endInclusive.getFullYear();
  return `${startStr} - ${endStr}, ${year}`;
}

// The period containing `date`, per the given settings.
export function periodContaining(date: Date, settings: PeriodSettings): Period {
  if (settings.periodType === "weekly") {
    const start = mostRecentWeekStart(date, settings.weekStartDay);
    const end = addDays(start, 7);
    return { start, end, label: periodLabel(start, end) };
  }
  if (settings.periodType === "biweekly") {
    const anchor = mostRecentWeekStart(new Date(settings.biweeklyAnchor), settings.weekStartDay);
    const thisWeek = mostRecentWeekStart(date, settings.weekStartDay);
    const weeksSinceAnchor = Math.round((thisWeek.getTime() - anchor.getTime()) / (7 * 86_400_000));
    const parity = ((weeksSinceAnchor % 2) + 2) % 2;
    const start = addDays(thisWeek, parity === 0 ? 0 : -7);
    const end = addDays(start, 14);
    return { start, end, label: periodLabel(start, end) };
  }
  // monthly
  const d = startOfDay(date);
  const startDay = Math.min(settings.monthlyStartDay, 28);
  let periodMonthStart = new Date(d.getFullYear(), d.getMonth(), startDay);
  if (d.getDate() < startDay) {
    periodMonthStart = new Date(d.getFullYear(), d.getMonth() - 1, startDay);
  }
  const nextMonthStart = new Date(periodMonthStart.getFullYear(), periodMonthStart.getMonth() + 1, startDay);
  return { start: periodMonthStart, end: nextMonthStart, label: periodLabel(periodMonthStart, nextMonthStart) };
}

// Shifts to the previous/next period (offset -1 or +1) relative to a period already
// computed by periodContaining — walks by a day into the target period, then
// re-resolves via periodContaining so month-length differences etc. are handled.
export function shiftPeriod(period: Period, settings: PeriodSettings, offset: number): Period {
  const probeDate = offset < 0 ? addDays(period.start, -1) : period.end;
  return periodContaining(probeDate, settings);
}

// Each job carries its own period definition (see docs/data-model.md's "Timesheet
// periods" section) — this just narrows a Job down to the fields periodContaining needs.
export function jobPeriodSettings(job: Job): PeriodSettings {
  return {
    periodType: job.timesheetPeriodType,
    weekStartDay: job.timesheetWeekStartDay,
    biweeklyAnchor: job.timesheetBiweeklyAnchor,
    monthlyStartDay: job.timesheetMonthlyStartDay,
  };
}
