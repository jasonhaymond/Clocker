import { describe, expect, it } from "vitest";
import { mostRecentWeekStart, periodContaining, shiftPeriod, type PeriodSettings } from "../timesheetPeriods";

function d(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day);
}

describe("mostRecentWeekStart", () => {
  it("returns the same day when it is already the week-start day", () => {
    // Jan 5, 2026 is a Monday (weekday 1).
    const result = mostRecentWeekStart(d(2026, 0, 5), 1);
    expect(result.toDateString()).toBe(d(2026, 0, 5).toDateString());
  });

  it("walks back to the most recent occurrence of the configured week-start day", () => {
    // Jan 8, 2026 is a Thursday; the most recent Monday is Jan 5.
    const result = mostRecentWeekStart(d(2026, 0, 8), 1);
    expect(result.toDateString()).toBe(d(2026, 0, 5).toDateString());
  });

  it("supports a Sunday-start week", () => {
    // Jan 8, 2026 (Thursday) with Sunday (0) as the week start walks back to Jan 4.
    const result = mostRecentWeekStart(d(2026, 0, 8), 0);
    expect(result.toDateString()).toBe(d(2026, 0, 4).toDateString());
  });
});

describe("periodContaining", () => {
  const weeklySettings: PeriodSettings = {
    periodType: "weekly",
    weekStartDay: 1,
    biweeklyAnchor: d(2026, 0, 5).toISOString(),
    monthlyStartDay: 1,
  };

  it("computes a weekly period from Monday to the following Monday", () => {
    const period = periodContaining(d(2026, 0, 8), weeklySettings);
    expect(period.start.toDateString()).toBe(d(2026, 0, 5).toDateString());
    expect(period.end.toDateString()).toBe(d(2026, 0, 12).toDateString());
  });

  it("computes biweekly periods in sync with the anchor date", () => {
    const settings: PeriodSettings = { ...weeklySettings, periodType: "biweekly", biweeklyAnchor: d(2026, 0, 5).toISOString() };
    // The anchor week itself.
    const anchorPeriod = periodContaining(d(2026, 0, 8), settings);
    expect(anchorPeriod.start.toDateString()).toBe(d(2026, 0, 5).toDateString());
    expect(anchorPeriod.end.toDateString()).toBe(d(2026, 0, 19).toDateString());

    // One week later should still fall inside the same biweekly period (not start a new one).
    const sameBiweekPeriod = periodContaining(d(2026, 0, 15), settings);
    expect(sameBiweekPeriod.start.toDateString()).toBe(d(2026, 0, 5).toDateString());

    // Two weeks later starts a new biweekly period.
    const nextBiweekPeriod = periodContaining(d(2026, 0, 20), settings);
    expect(nextBiweekPeriod.start.toDateString()).toBe(d(2026, 0, 19).toDateString());
  });

  it("computes a monthly period starting on the configured day", () => {
    const settings: PeriodSettings = { ...weeklySettings, periodType: "monthly", monthlyStartDay: 15 };
    // Jan 20 falls after the 15th, so the period started Jan 15.
    const afterStart = periodContaining(d(2026, 0, 20), settings);
    expect(afterStart.start.toDateString()).toBe(d(2026, 0, 15).toDateString());
    expect(afterStart.end.toDateString()).toBe(d(2026, 1, 15).toDateString());

    // Jan 10 falls before the 15th, so it belongs to the period that started Dec 15.
    const beforeStart = periodContaining(d(2026, 0, 10), settings);
    expect(beforeStart.start.toDateString()).toBe(d(2025, 11, 15).toDateString());
    expect(beforeStart.end.toDateString()).toBe(d(2026, 0, 15).toDateString());
  });

  it("shiftPeriod moves to the adjacent period and back", () => {
    const period = periodContaining(d(2026, 0, 8), weeklySettings);
    const next = shiftPeriod(period, weeklySettings, 1);
    const prev = shiftPeriod(next, weeklySettings, -1);

    expect(next.start.toDateString()).toBe(d(2026, 0, 12).toDateString());
    expect(prev.start.toDateString()).toBe(period.start.toDateString());
  });
});
