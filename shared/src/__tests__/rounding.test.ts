import { afterEach, describe, expect, it, vi } from "vitest";
import { roundedWorkedMillis } from "../rounding";
import { makeBreak, makeJob, makeShift } from "./testFixtures";

function at(day: number, hour: number, minute: number): string {
  return new Date(2026, 0, day, hour, minute, 0).toISOString();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("roundedWorkedMillis", () => {
  it("returns the exact worked time when rounding is disabled", () => {
    const job = makeJob({ roundingEnabled: false });
    const shift = makeShift({ clockIn: at(5, 9, 7), clockOut: at(5, 17, 3) });
    const result = roundedWorkedMillis(shift, [], job);
    expect(result).toBe(new Date(at(5, 17, 3)).getTime() - new Date(at(5, 9, 7)).getTime());
  });

  it("rounds clock-in and clock-out to the nearest increment", () => {
    const job = makeJob({ roundingEnabled: true, roundingMode: "nearest", roundingIncrementMinutes: 15 });
    // 9:07 rounds to 9:00, 17:08 rounds to 17:15 (nearest 15).
    const shift = makeShift({ clockIn: at(5, 9, 7), clockOut: at(5, 17, 8) });
    const result = roundedWorkedMillis(shift, [], job);
    expect(result).toBe((17 * 60 + 15 - (9 * 60)) * 60_000);
  });

  it("rounds up in both directions when mode is 'up'", () => {
    const job = makeJob({ roundingEnabled: true, roundingMode: "up", roundingIncrementMinutes: 15 });
    // 9:01 rounds up to 9:15, 17:01 rounds up to 17:15.
    const shift = makeShift({ clockIn: at(5, 9, 1), clockOut: at(5, 17, 1) });
    const result = roundedWorkedMillis(shift, [], job);
    expect(result).toBe((17 * 60 + 15 - (9 * 60 + 15)) * 60_000);
  });

  it("rounds down in both directions when mode is 'down'", () => {
    const job = makeJob({ roundingEnabled: true, roundingMode: "down", roundingIncrementMinutes: 15 });
    // 9:14 rounds down to 9:00, 17:14 rounds down to 17:00.
    const shift = makeShift({ clockIn: at(5, 9, 14), clockOut: at(5, 17, 14) });
    const result = roundedWorkedMillis(shift, [], job);
    expect(result).toBe(8 * 60 * 60_000);
  });

  it("never rounds break time, only the shift's own start/end", () => {
    const job = makeJob({ roundingEnabled: true, roundingMode: "nearest", roundingIncrementMinutes: 15 });
    const shift = makeShift({ clockIn: at(5, 9, 0), clockOut: at(5, 17, 0) });
    // An 11-minute break, which would itself round to 15 if it were (wrongly) rounded.
    const aBreak = makeBreak({ shiftId: shift.id, start: at(5, 12, 0), end: at(5, 12, 11) });
    const result = roundedWorkedMillis(shift, [aBreak], job);
    expect(result).toBe(8 * 60 * 60_000 - 11 * 60_000);
  });

  it("rounds an open shift's end against the current moment", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 5, 13, 7, 0));
    const job = makeJob({ roundingEnabled: true, roundingMode: "nearest", roundingIncrementMinutes: 15 });
    const shift = makeShift({ clockIn: at(5, 9, 0), clockOut: null });
    const result = roundedWorkedMillis(shift, [], job);
    // 9:00 stays 9:00, 13:07 rounds to 13:00 (nearest 15) -> 4h worked.
    expect(result).toBe(4 * 60 * 60_000);
  });
});
