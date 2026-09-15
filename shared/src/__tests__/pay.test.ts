import { describe, expect, it } from "vitest";
import { calculateShiftPay } from "../pay";
import { makeJob, makeShift, makeTier, makeVersion } from "./testFixtures";

// Built via the local Date constructor (not hand-typed UTC literals) so the calendar day
// each one falls on — and therefore which ISO week it groups into via calculateShiftPay's
// Monday-start startOfWeek — is the same regardless of which timezone the test runner is
// in. Jan 5, 2026 is a Monday; Jan 6 is the same week; Jan 13 is the following week.
function at(day: number, hour: number): string {
  return new Date(2026, 0, day, hour, 0, 0).toISOString();
}

describe("calculateShiftPay", () => {
  it("pays a plain shift with no overtime configured at a flat rate", () => {
    const job = makeJob({ id: "job-1" });
    const tier = makeTier({ id: "tier-1", jobId: "job-1", isDefault: true });
    const version = makeVersion({ tierId: "tier-1", hourlyRateCents: 2000, effectiveFrom: at(1, 0) });
    const shift = makeShift({ id: "s1", jobId: "job-1", clockIn: at(5, 9), clockOut: at(5, 17) });

    const [result] = calculateShiftPay({
      job,
      tiers: [tier],
      versions: [version],
      shiftsWithHours: [{ shift, workedHours: 8 }],
    });

    expect(result.regularHours).toBe(8);
    expect(result.overtimeHours).toBe(0);
    expect(result.rateCentsPerHour).toBe(2000);
    expect(result.totalCents).toBe(16000);
  });

  it("resolves the tier a shift explicitly references over the job's default", () => {
    const job = makeJob({ id: "job-1" });
    const standard = makeTier({ id: "standard", jobId: "job-1", name: "Standard", isDefault: true });
    const holiday = makeTier({ id: "holiday", jobId: "job-1", name: "Holiday", isDefault: false });
    const versions = [
      makeVersion({ tierId: "standard", hourlyRateCents: 2000, effectiveFrom: at(1, 0) }),
      makeVersion({ tierId: "holiday", hourlyRateCents: 4000, effectiveFrom: at(1, 0) }),
    ];
    const shift = makeShift({ jobId: "job-1", rateTierId: "holiday", clockIn: at(5, 9), clockOut: at(5, 17) });

    const [result] = calculateShiftPay({ job, tiers: [standard, holiday], versions, shiftsWithHours: [{ shift, workedHours: 8 }] });

    expect(result.tierName).toBe("Holiday");
    expect(result.rateCentsPerHour).toBe(4000);
    expect(result.totalCents).toBe(32000);
  });

  it("falls back to the job's default tier when a shift's own tier can't be found", () => {
    const job = makeJob({ id: "job-1" });
    const standard = makeTier({ id: "standard", jobId: "job-1", isDefault: true });
    const version = makeVersion({ tierId: "standard", hourlyRateCents: 1500, effectiveFrom: at(1, 0) });
    // References a tier that doesn't exist in the tiers array passed in (e.g. deleted).
    const shift = makeShift({ jobId: "job-1", rateTierId: "deleted-tier", clockIn: at(5, 9), clockOut: at(5, 17) });

    const [result] = calculateShiftPay({ job, tiers: [standard], versions: [version], shiftsWithHours: [{ shift, workedHours: 8 }] });

    expect(result.tierName).toBe("Standard");
    expect(result.rateCentsPerHour).toBe(1500);
  });

  it("uses the rate version effective at the shift's clock-in, not the latest one overall", () => {
    const job = makeJob({ id: "job-1" });
    const tier = makeTier({ id: "tier-1", jobId: "job-1", isDefault: true });
    const versions = [
      makeVersion({ tierId: "tier-1", hourlyRateCents: 1500, effectiveFrom: at(1, 0) }),
      // A raise effective Jan 10 — a shift worked Jan 5 should still use the old rate.
      makeVersion({ tierId: "tier-1", hourlyRateCents: 2500, effectiveFrom: at(10, 0) }),
    ];
    const shift = makeShift({ jobId: "job-1", clockIn: at(5, 9), clockOut: at(5, 17) });

    const [result] = calculateShiftPay({ job, tiers: [tier], versions, shiftsWithHours: [{ shift, workedHours: 8 }] });

    expect(result.rateCentsPerHour).toBe(1500);
  });

  it("returns a null rate and zero pay when no rate version has ever been set", () => {
    const job = makeJob({ id: "job-1" });
    const tier = makeTier({ id: "tier-1", jobId: "job-1", isDefault: true });
    const shift = makeShift({ jobId: "job-1", clockIn: at(5, 9), clockOut: at(5, 17) });

    const [result] = calculateShiftPay({ job, tiers: [tier], versions: [], shiftsWithHours: [{ shift, workedHours: 8 }] });

    expect(result.rateCentsPerHour).toBeNull();
    expect(result.totalCents).toBe(0);
  });

  it("splits a single shift across the weekly overtime threshold", () => {
    const job = makeJob({ id: "job-1", overtimeMultiplier: 1.5, overtimeWeeklyThresholdHours: 6 });
    const tier = makeTier({ id: "tier-1", jobId: "job-1", isDefault: true });
    const version = makeVersion({ tierId: "tier-1", hourlyRateCents: 2000, effectiveFrom: at(1, 0) });
    const shift = makeShift({ jobId: "job-1", clockIn: at(5, 9), clockOut: at(5, 17) }); // 8 worked hours, threshold 6

    const [result] = calculateShiftPay({ job, tiers: [tier], versions: [version], shiftsWithHours: [{ shift, workedHours: 8 }] });

    expect(result.regularHours).toBe(6);
    expect(result.overtimeHours).toBe(2);
    // 6 * $20 + 2 * $20 * 1.5 = $120 + $60 = $180
    expect(result.totalCents).toBe(18000);
  });

  it("carries the weekly overtime budget across multiple shifts in the same week", () => {
    const job = makeJob({ id: "job-1", overtimeMultiplier: 2, overtimeWeeklyThresholdHours: 10 });
    const tier = makeTier({ id: "tier-1", jobId: "job-1", isDefault: true });
    const version = makeVersion({ tierId: "tier-1", hourlyRateCents: 1000, effectiveFrom: at(1, 0) });
    const monday = makeShift({ id: "mon", jobId: "job-1", clockIn: at(5, 9), clockOut: at(5, 17) }); // 8h
    const tuesday = makeShift({ id: "tue", jobId: "job-1", clockIn: at(6, 9), clockOut: at(6, 17) }); // 8h, same week

    const results = calculateShiftPay({
      job,
      tiers: [tier],
      versions: [version],
      shiftsWithHours: [
        { shift: tuesday, workedHours: 8 }, // intentionally out of order — pay sorts by clockIn itself
        { shift: monday, workedHours: 8 },
      ],
    });
    const mondayResult = results.find((r) => r.shiftId === "mon")!;
    const tuesdayResult = results.find((r) => r.shiftId === "tue")!;

    expect(mondayResult.regularHours).toBe(8);
    expect(mondayResult.overtimeHours).toBe(0);
    // Monday used 8 of the 10-hour weekly budget; Tuesday gets 2 more regular hours, rest overtime.
    expect(tuesdayResult.regularHours).toBe(2);
    expect(tuesdayResult.overtimeHours).toBe(6);
  });

  it("does not carry the weekly overtime budget across different weeks", () => {
    const job = makeJob({ id: "job-1", overtimeMultiplier: 1.5, overtimeWeeklyThresholdHours: 6 });
    const tier = makeTier({ id: "tier-1", jobId: "job-1", isDefault: true });
    const version = makeVersion({ tierId: "tier-1", hourlyRateCents: 1000, effectiveFrom: at(1, 0) });
    const weekOne = makeShift({ id: "w1", jobId: "job-1", clockIn: at(5, 9), clockOut: at(5, 17) }); // 8h, week of Jan 5
    const weekTwo = makeShift({ id: "w2", jobId: "job-1", clockIn: at(13, 9), clockOut: at(13, 17) }); // 8h, following week

    const results = calculateShiftPay({ job, tiers: [tier], versions: [version], shiftsWithHours: [{ shift: weekOne, workedHours: 8 }, { shift: weekTwo, workedHours: 8 }] });
    const w2Result = results.find((r) => r.shiftId === "w2")!;

    // Week two's shift shouldn't see any budget already consumed by week one.
    expect(w2Result.regularHours).toBe(6);
    expect(w2Result.overtimeHours).toBe(2);
  });

  it("pays a manually-flagged overtime shift entirely at the overtime rate", () => {
    const job = makeJob({ id: "job-1", overtimeMultiplier: 1.5, overtimeWeeklyThresholdHours: 40 });
    const tier = makeTier({ id: "tier-1", jobId: "job-1", isDefault: true });
    const version = makeVersion({ tierId: "tier-1", hourlyRateCents: 2000, effectiveFrom: at(1, 0) });
    const shift = makeShift({ jobId: "job-1", clockIn: at(5, 9), clockOut: at(5, 13), isOvertime: true }); // only 4h worked, well under the 40h threshold

    const [result] = calculateShiftPay({ job, tiers: [tier], versions: [version], shiftsWithHours: [{ shift, workedHours: 4 }] });

    expect(result.regularHours).toBe(0);
    expect(result.overtimeHours).toBe(4);
    // 4 * $20 * 1.5 = $120, even though the weekly threshold was nowhere close to being hit.
    expect(result.totalCents).toBe(12000);
  });

  it("does not let a manually-flagged overtime shift consume the weekly regular-hours budget of other shifts", () => {
    const job = makeJob({ id: "job-1", overtimeMultiplier: 1.5, overtimeWeeklyThresholdHours: 10 });
    const tier = makeTier({ id: "tier-1", jobId: "job-1", isDefault: true });
    const version = makeVersion({ tierId: "tier-1", hourlyRateCents: 1000, effectiveFrom: at(1, 0) });
    const flagged = makeShift({ id: "flagged", jobId: "job-1", clockIn: at(5, 9), clockOut: at(5, 17), isOvertime: true }); // 8h, manually flagged
    const normal = makeShift({ id: "normal", jobId: "job-1", clockIn: at(6, 9), clockOut: at(6, 17) }); // 8h, same week, normal

    const results = calculateShiftPay({
      job,
      tiers: [tier],
      versions: [version],
      shiftsWithHours: [{ shift: flagged, workedHours: 8 }, { shift: normal, workedHours: 8 }],
    });
    const normalResult = results.find((r) => r.shiftId === "normal")!;

    // If the flagged shift had wrongly counted toward the 10h budget, normal would only
    // get 2 regular hours. It should get the full 8 — the threshold budget is untouched.
    expect(normalResult.regularHours).toBe(8);
    expect(normalResult.overtimeHours).toBe(0);
  });

  it("pays a manually-flagged overtime shift at 1x when the job has no overtime multiplier configured", () => {
    const job = makeJob({ id: "job-1", overtimeMultiplier: null, overtimeWeeklyThresholdHours: null });
    const tier = makeTier({ id: "tier-1", jobId: "job-1", isDefault: true });
    const version = makeVersion({ tierId: "tier-1", hourlyRateCents: 2000, effectiveFrom: at(1, 0) });
    const shift = makeShift({ jobId: "job-1", clockIn: at(5, 9), clockOut: at(5, 13), isOvertime: true });

    const [result] = calculateShiftPay({ job, tiers: [tier], versions: [version], shiftsWithHours: [{ shift, workedHours: 4 }] });

    expect(result.regularHours).toBe(0);
    expect(result.overtimeHours).toBe(4);
    // No multiplier configured — still marked as overtime hours, but paid at the plain rate.
    expect(result.totalCents).toBe(8000);
  });
});
