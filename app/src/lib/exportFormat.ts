import type { Break, Job, RateTier, RateVersion, Shift } from "../types";
import { calculateShiftPay, formatCents, type ShiftPay } from "./pay";
import { breakMillis, formatClock, formatDay, workedMillis } from "./time";

export interface ExportJobGroup {
  jobId: string;
  job: Job | undefined; // undefined if the job was since deleted
  shifts: Shift[]; // sorted by clockIn ascending
  totalHours: number;
  totalCents: number;
  hasRate: boolean;
}

// Groups shifts by job (sorted chronologically within each job) and computes pay for
// every shift via calculateShiftPay, so CSV/email export share one source of truth for
// hours and pay with the History screen. Job order: jobs with any pay configured first,
// alphabetical within that — matches "Job, then day" from the reference export UI.
export function groupShiftsByJob(params: {
  shifts: Shift[];
  jobsById: Record<string, Job>;
  tiers: RateTier[];
  versions: RateVersion[];
  breaksByShift: Record<string, Break[]>;
}): { groups: ExportJobGroup[]; payByShiftId: Map<string, ShiftPay> } {
  const { shifts, jobsById, tiers, versions, breaksByShift } = params;
  const payByShiftId = new Map<string, ShiftPay>();
  const shiftsByJob = new Map<string, Shift[]>();
  for (const s of shifts) {
    if (!shiftsByJob.has(s.jobId)) shiftsByJob.set(s.jobId, []);
    shiftsByJob.get(s.jobId)!.push(s);
  }

  const groups: ExportJobGroup[] = [];
  for (const [jobId, jobShifts] of shiftsByJob) {
    const job = jobsById[jobId];
    const sorted = [...jobShifts].sort((a, b) => (a.clockIn < b.clockIn ? -1 : 1));
    let totalHours = 0;
    let totalCents = 0;
    let hasRate = false;

    if (job) {
      const jobTiers = tiers.filter((t) => t.jobId === jobId);
      const tierIds = new Set(jobTiers.map((t) => t.id));
      const jobVersions = versions.filter((v) => tierIds.has(v.tierId));
      const shiftsWithHours = sorted.map((shift) => ({
        shift,
        workedHours: workedMillis(shift, breaksByShift[shift.id] ?? []) / 3_600_000,
      }));
      for (const pay of calculateShiftPay({ job, tiers: jobTiers, versions: jobVersions, shiftsWithHours })) {
        payByShiftId.set(pay.shiftId, pay);
        totalHours += pay.regularHours + pay.overtimeHours;
        totalCents += pay.totalCents;
        if (pay.rateCentsPerHour != null) hasRate = true;
      }
    } else {
      for (const shift of sorted) totalHours += workedMillis(shift, breaksByShift[shift.id] ?? []) / 3_600_000;
    }

    groups.push({ jobId, job, shifts: sorted, totalHours, totalCents, hasRate });
  }

  groups.sort((a, b) => {
    if (a.hasRate !== b.hasRate) return a.hasRate ? -1 : 1;
    return (a.job?.name ?? "").localeCompare(b.job?.name ?? "");
  });

  return { groups, payByShiftId };
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildCsv(groups: ExportJobGroup[], payByShiftId: Map<string, ShiftPay>, breaksByShift: Record<string, Break[]>): string {
  const header = ["Job", "Rate", "Clock In", "Clock Out", "Break (hrs)", "Regular (hrs)", "Overtime (hrs)", "Pay", "Notes"];
  const rows: string[][] = [];
  for (const group of groups) {
    for (const shift of group.shifts) {
      const pay = payByShiftId.get(shift.id);
      const breakHrs = breakMillis(breaksByShift[shift.id] ?? []) / 3_600_000;
      rows.push([
        group.job?.name ?? "Deleted job",
        pay?.tierName ?? "",
        new Date(shift.clockIn).toLocaleString(),
        shift.clockOut ? new Date(shift.clockOut).toLocaleString() : "",
        breakHrs.toFixed(2),
        (pay?.regularHours ?? workedMillis(shift, breaksByShift[shift.id] ?? []) / 3_600_000).toFixed(2),
        (pay?.overtimeHours ?? 0).toFixed(2),
        pay && pay.rateCentsPerHour != null ? (pay.totalCents / 100).toFixed(2) : "",
        shift.notes ?? "",
      ]);
    }
  }
  return [header, ...rows].map((cols) => cols.map((c) => csvEscape(String(c))).join(",")).join("\n");
}

export interface EmailOptions {
  includeEarnings: boolean;
  includeComments: boolean;
  includeTimes: boolean;
}

// A self-contained HTML fragment (inline styles only — email clients strip <style>
// blocks and external stylesheets) grouped job-by-job with a shift table per job, a
// per-job subtotal, and a grand total. Passed to expo-mail-composer as the body with
// isHtml: true.
export function buildEmailHtml(params: {
  groups: ExportJobGroup[];
  payByShiftId: Map<string, ShiftPay>;
  breaksByShift: Record<string, Break[]>;
  rangeLabel: string;
  options: EmailOptions;
}): string {
  const { groups, payByShiftId, breaksByShift, rangeLabel, options } = params;
  const anyRate = groups.some((g) => g.hasRate);
  const grandHours = groups.reduce((sum, g) => sum + g.totalHours, 0);
  const grandCents = groups.reduce((sum, g) => sum + g.totalCents, 0);

  const th = 'style="text-align:left;padding:6px 10px;border-bottom:2px solid #333;font-size:13px;color:#333;"';
  const td = 'style="padding:6px 10px;border-bottom:1px solid #e5e5e5;font-size:13px;color:#111;"';
  const tdRight = 'style="padding:6px 10px;border-bottom:1px solid #e5e5e5;font-size:13px;color:#111;text-align:right;"';

  const jobSections = groups
    .map((group) => {
      const rows = group.shifts
        .map((shift) => {
          const breaks = breaksByShift[shift.id] ?? [];
          const hours = workedMillis(shift, breaks) / 3_600_000;
          const pay = payByShiftId.get(shift.id);
          const cells = [
            `<td ${td}>${formatDay(shift.clockIn)}</td>`,
            options.includeTimes ? `<td ${td}>${formatClock(shift.clockIn)}</td>` : "",
            options.includeTimes ? `<td ${td}>${shift.clockOut ? formatClock(shift.clockOut) : "in progress"}</td>` : "",
            `<td ${tdRight}>${hours.toFixed(2)}</td>`,
            options.includeEarnings && group.hasRate
              ? `<td ${tdRight}>${pay && pay.rateCentsPerHour != null ? formatCents(pay.totalCents) : ""}</td>`
              : "",
            options.includeComments ? `<td ${td}>${shift.notes ? escapeHtml(shift.notes) : ""}</td>` : "",
          ];
          return `<tr>${cells.filter(Boolean).join("")}</tr>`;
        })
        .join("");

      const headerCells = ["Date", options.includeTimes ? "Start" : "", options.includeTimes ? "End" : "", "Hours"];
      if (options.includeEarnings && group.hasRate) headerCells.push("Pay");
      if (options.includeComments) headerCells.push("Notes");

      return `
        <h3 style="margin:24px 0 8px 0;color:${group.job?.colorHex ?? "#333"};font-family:sans-serif;">${
          group.job?.name ?? "Deleted job"
        }</h3>
        <table style="border-collapse:collapse;width:100%;font-family:sans-serif;">
          <thead><tr>${headerCells
            .filter(Boolean)
            .map((c) => `<th ${th}>${c}</th>`)
            .join("")}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="font-family:sans-serif;font-size:13px;color:#444;margin:6px 0 0 0;">
          Subtotal: <strong>${group.totalHours.toFixed(2)} hrs</strong>${
            options.includeEarnings && group.hasRate ? ` &middot; <strong>${formatCents(group.totalCents)}</strong>` : ""
          }
        </p>`;
    })
    .join("");

  return `
    <div style="font-family:sans-serif;color:#111;">
      <p style="font-size:14px;color:#444;">${escapeHtml(rangeLabel)}</p>
      ${jobSections}
      <hr style="margin:24px 0;border:none;border-top:2px solid #333;" />
      <p style="font-size:16px;">
        <strong>Total: ${grandHours.toFixed(2)} hrs${
          options.includeEarnings && anyRate ? ` &middot; ${formatCents(grandCents)}` : ""
        }</strong>
      </p>
    </div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// A plain-text equivalent of buildEmailHtml — same grouping/options, for email clients
// or contexts (clipboard, plain-text share) where HTML isn't appropriate.
export function buildPlainText(params: {
  groups: ExportJobGroup[];
  payByShiftId: Map<string, ShiftPay>;
  breaksByShift: Record<string, Break[]>;
  rangeLabel: string;
  options: EmailOptions;
}): string {
  const { groups, payByShiftId, breaksByShift, rangeLabel, options } = params;
  const anyRate = groups.some((g) => g.hasRate);
  const grandHours = groups.reduce((sum, g) => sum + g.totalHours, 0);
  const grandCents = groups.reduce((sum, g) => sum + g.totalCents, 0);

  const lines: string[] = [rangeLabel, ""];

  for (const group of groups) {
    lines.push(group.job?.name ?? "Deleted job");
    lines.push("-".repeat((group.job?.name ?? "Deleted job").length));
    for (const shift of group.shifts) {
      const breaks = breaksByShift[shift.id] ?? [];
      const hours = workedMillis(shift, breaks) / 3_600_000;
      const pay = payByShiftId.get(shift.id);
      const parts = [formatDay(shift.clockIn)];
      if (options.includeTimes) {
        parts.push(`${formatClock(shift.clockIn)} - ${shift.clockOut ? formatClock(shift.clockOut) : "in progress"}`);
      }
      parts.push(`${hours.toFixed(2)} hrs`);
      if (options.includeEarnings && group.hasRate && pay && pay.rateCentsPerHour != null) {
        parts.push(formatCents(pay.totalCents));
      }
      lines.push(`  ${parts.join(" · ")}`);
      if (options.includeComments && shift.notes) {
        lines.push(`    Note: ${shift.notes}`);
      }
    }
    lines.push(
      `  Subtotal: ${group.totalHours.toFixed(2)} hrs${
        options.includeEarnings && group.hasRate ? ` · ${formatCents(group.totalCents)}` : ""
      }`,
    );
    lines.push("");
  }

  lines.push(`Total: ${grandHours.toFixed(2)} hrs${options.includeEarnings && anyRate ? ` · ${formatCents(grandCents)}` : ""}`);

  return lines.join("\n");
}
