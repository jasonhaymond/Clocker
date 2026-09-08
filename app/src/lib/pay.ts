import type { Job, RateTier, RateVersion, Shift } from "../types";
import { startOfWeek } from "./time";

export interface ShiftPay {
  shiftId: string;
  tierName: string | null;
  rateCentsPerHour: number | null; // null when no rate version is active yet for this shift's tier
  regularHours: number;
  overtimeHours: number;
  totalCents: number;
}

// Finds the tier a shift was worked under: the one it explicitly references, or the
// job's default tier if it doesn't (e.g. it predates tiers existing, or was clocked in
// before a second tier was ever added).
function resolveTier(shift: Shift, tiers: RateTier[]): RateTier | null {
  if (shift.rateTierId) {
    const explicit = tiers.find((t) => t.id === shift.rateTierId);
    if (explicit) return explicit;
  }
  return tiers.find((t) => t.isDefault) ?? null;
}

// The rate in effect for a tier at a given moment: the version with the latest
// `effectiveFrom` at or before that moment. Returns null if the tier has no rate version
// yet (e.g. a job created with no rate set).
function resolveRateCents(tier: RateTier | null, versions: RateVersion[], atIso: string): number | null {
  if (!tier) return null;
  const at = new Date(atIso).getTime();
  let best: RateVersion | null = null;
  for (const v of versions) {
    if (v.tierId !== tier.id) continue;
    const effective = new Date(v.effectiveFrom).getTime();
    if (effective > at) continue;
    if (!best || effective > new Date(best.effectiveFrom).getTime()) best = v;
  }
  return best ? best.hourlyRateCents : null;
}

// Computes pay per shift, applying the job's overtime multiplier (if configured) after
// its weekly hour threshold. Overtime is allocated within each ISO week (Mon-Sun) formed
// by the shifts passed in — shifts earlier in the week fill the "regular" bucket first,
// and any hours past the threshold (even split within a single shift) become overtime,
// at that shift's own resolved rate. Weeks are only as complete as the shifts you pass
// in — for an accurate weekly overtime total, pass a full calendar week's shifts.
export function calculateShiftPay(params: {
  job: Job;
  tiers: RateTier[];
  versions: RateVersion[];
  shiftsWithHours: { shift: Shift; workedHours: number }[];
}): ShiftPay[] {
  const { job, tiers, versions, shiftsWithHours } = params;
  const overtimeEnabled = job.overtimeMultiplier != null && job.overtimeWeeklyThresholdHours != null;

  const sorted = [...shiftsWithHours].sort(
    (a, b) => new Date(a.shift.clockIn).getTime() - new Date(b.shift.clockIn).getTime(),
  );

  const cumulativeHoursByWeek = new Map<string, number>();
  const results: ShiftPay[] = [];

  for (const { shift, workedHours } of sorted) {
    const tier = resolveTier(shift, tiers);
    const rateCents = resolveRateCents(tier, versions, shift.clockIn);

    let regularHours = workedHours;
    let overtimeHours = 0;

    if (overtimeEnabled) {
      const weekKey = startOfWeek(new Date(shift.clockIn)).toISOString();
      const before = cumulativeHoursByWeek.get(weekKey) ?? 0;
      const threshold = job.overtimeWeeklyThresholdHours as number;
      const remainingRegular = Math.max(0, threshold - before);
      regularHours = Math.min(workedHours, remainingRegular);
      overtimeHours = workedHours - regularHours;
      cumulativeHoursByWeek.set(weekKey, before + workedHours);
    }

    const totalCents =
      rateCents == null
        ? 0
        : Math.round(regularHours * rateCents + overtimeHours * rateCents * (job.overtimeMultiplier as number));

    results.push({
      shiftId: shift.id,
      tierName: tier?.name ?? null,
      rateCentsPerHour: rateCents,
      regularHours,
      overtimeHours,
      totalCents,
    });
  }

  return results;
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
