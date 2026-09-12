// Parses CSV exports from the "Hours Tracker" app into a shape ready to import as
// Clocker jobs/shifts/breaks, plus the pure grouping/preview logic both clients need
// around that. See docs/import-format.md for the full column reference this mirrors, and
// both clients' Settings -> Import Data screen for the UI that uses it. Actually WRITING
// the parsed data (matching existing jobs, creating new ones, inserting shifts/breaks) is
// orchestrated per-client instead (`{app,web}/src/lib/importHoursTracker.ts`) — it calls
// each client's own job/shift mutation functions, which differ enough — local SQLite vs.
// a direct server call — that sharing that part wouldn't save real work; see
// docs/architecture.md's "two clients" reasoning.

import type { Job } from "./types";

// The exact header row Hours Tracker exports today — shown in the app and in
// docs/import-format.md as "what a compatible file looks like," not enforced verbatim by
// the parser below (which only requires the three columns it actually needs to be
// present, by name, so a harmless future reordering/addition of columns doesn't break it).
export const HOURS_TRACKER_CSV_HEADER =
  'Job,Clocked In,Clocked Out,Duration,Hourly Rate,Earnings,Comment,Tags,Breaks,Adjustments,Mileage';

export interface ParsedBreak {
  start: string; // ISO
  end: string; // ISO
}

export interface ParsedImportRow {
  jobName: string;
  clockIn: string; // ISO
  clockOut: string; // ISO
  hourlyRateCents: number | null;
  notes: string | null;
  breaks: ParsedBreak[];
}

export interface ParseImportResult {
  rows: ParsedImportRow[];
  // One entry per skipped/malformed row, human-readable, referencing the file's own row
  // number (header = row 1, matching what a spreadsheet app would show) so a user can
  // find and fix the source row if they want to.
  errors: string[];
}

// Minimal RFC4180-ish CSV parser: quoted fields (with "" for a literal embedded quote),
// commas and newlines inside quotes, CRLF or LF line endings. Hand-rolled rather than a
// dependency — `shared/` is deliberately dependency-free so both clients can import it
// regardless of bundler (see this package's own index.ts header comment).
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  function pushField() {
    row.push(field);
    field = "";
  }
  function pushRow() {
    pushField();
    rows.push(row);
    row = [];
  }
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      pushField();
      i++;
      continue;
    }
    if (c === "\r") {
      i++; // swallow — the following "\n" (or EOF) ends the row
      continue;
    }
    if (c === "\n") {
      pushRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Trailing field/row for a file not ending in a newline.
  if (field.length > 0 || row.length > 0) pushRow();
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

// "3/17/2026 3:55 PM" -> Date. Written explicitly (not handed to `new Date(string)`)
// because that constructor's parsing of this exact shape isn't guaranteed identical
// across JS engines (V8 on web vs. Hermes on mobile) — matches how this app already
// avoids ambient date-string parsing elsewhere (e.g. ExportScreen's custom-range inputs).
function parseUsDateTime(raw: string): Date | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  const [, monthStr, dayStr, yearStr, hourStr, minuteStr, ampm] = m;
  let hour = Number(hourStr) % 12;
  if (ampm.toUpperCase() === "PM") hour += 12;
  const date = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr), hour, Number(minuteStr), 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Anchors an hour/minute-of-day to whichever of two candidate calendar days actually
// falls within [rangeStart, rangeEnd] — used because both a shift's own start/end times
// and a break's start/end times are recorded as time-of-day only where the date is
// otherwise implied, and a shift (or a break within it) can genuinely cross midnight.
function resolveTimeOfDayWithin(hour: number, minute: number, rangeStart: Date, rangeEnd: Date): Date {
  const base = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
  for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
    const candidate = new Date(base);
    candidate.setDate(candidate.getDate() + dayOffset);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate.getTime() >= rangeStart.getTime() && candidate.getTime() <= rangeEnd.getTime()) return candidate;
  }
  // Fell outside the range entirely (a malformed/edge-case export) — clamp to the range's
  // own start rather than letting a bad break time land somewhere else in the app.
  const fallback = new Date(base);
  fallback.setHours(hour, minute, 0, 0);
  return fallback;
}

// Breaks are recorded as time-of-day only, e.g. "0.17h (1:25 PM to 1:35 PM)", possibly
// several per shift separated by ";" — the leading "<duration>h " is redundant with the
// times themselves (and sometimes doesn't quite agree with them once rounded) and is
// ignored in favor of deriving the actual duration from the parsed start/end.
function parseBreaksField(field: string, shiftStart: Date, shiftEnd: Date): ParsedBreak[] {
  if (!field.trim()) return [];
  const breaks: ParsedBreak[] = [];
  for (const entry of field.split(";")) {
    const m = entry.match(/\((\d{1,2}):(\d{2})\s*(AM|PM)\s+to\s+(\d{1,2}):(\d{2})\s*(AM|PM)\)/i);
    if (!m) continue;
    const [, sh, sm, sAmPm, eh, em, eAmPm] = m;
    let startHour = Number(sh) % 12;
    if (sAmPm.toUpperCase() === "PM") startHour += 12;
    let endHour = Number(eh) % 12;
    if (eAmPm.toUpperCase() === "PM") endHour += 12;
    const start = resolveTimeOfDayWithin(startHour, Number(sm), shiftStart, shiftEnd);
    // The end is anchored relative to its own start (not the shift's start) so a break
    // that itself crosses midnight still lands after its own start rather than before it.
    let end = resolveTimeOfDayWithin(endHour, Number(em), start, shiftEnd);
    if (end.getTime() < start.getTime()) end = new Date(end.getTime() + 24 * 3_600_000);
    breaks.push({ start: start.toISOString(), end: end.toISOString() });
  }
  return breaks;
}

function parseHourlyRateCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

// Comment/Tags/Adjustments/Mileage all fold into Clocker's single shift-notes field,
// which is the only free-text field a shift has — rather than silently dropping data
// Hours Tracker recorded that Clocker has no dedicated place for.
function buildNotes(comment: string, tags: string, adjustments: string, mileage: string): string | null {
  const parts: string[] = [];
  if (comment.trim()) parts.push(comment.trim());
  if (tags.trim()) parts.push(`Tags: ${tags.trim()}`);
  if (adjustments.trim()) parts.push(`Adjustment (not applied to pay): ${adjustments.trim()}`);
  const mileageNum = Number(mileage.trim());
  if (mileage.trim() && Number.isFinite(mileageNum) && mileageNum > 0) parts.push(`Mileage: ${mileage.trim()}`);
  return parts.length > 0 ? parts.join("\n") : null;
}

export function parseHoursTrackerCsv(csvText: string): ParseImportResult {
  const table = parseCsv(csvText);
  if (table.length === 0) return { rows: [], errors: ["The file is empty."] };

  const header = table[0].map((h) => h.trim());
  const required = ["Job", "Clocked In", "Clocked Out"];
  if (!required.every((col) => header.includes(col))) {
    return {
      rows: [],
      errors: [
        `This doesn't look like an Hours Tracker export — expected a header including ${required.join(", ")}, got: ${header.join(", ") || "(empty)"}`,
      ],
    };
  }

  const col = (name: string) => header.indexOf(name);
  const jobCol = col("Job");
  const clockInCol = col("Clocked In");
  const clockOutCol = col("Clocked Out");
  const rateCol = col("Hourly Rate");
  const commentCol = col("Comment");
  const tagsCol = col("Tags");
  const breaksCol = col("Breaks");
  const adjustmentsCol = col("Adjustments");
  const mileageCol = col("Mileage");

  const rows: ParsedImportRow[] = [];
  const errors: string[] = [];
  for (let i = 1; i < table.length; i++) {
    const line = i + 1; // 1-indexed, matching a spreadsheet's row numbers (header = row 1)
    const cells = table[i];
    const jobName = (cells[jobCol] ?? "").trim();
    if (!jobName) {
      errors.push(`Row ${line}: missing "Job" — skipped.`);
      continue;
    }
    const clockIn = parseUsDateTime(cells[clockInCol] ?? "");
    if (!clockIn) {
      errors.push(`Row ${line}: couldn't parse "Clocked In" value "${cells[clockInCol] ?? ""}" — skipped.`);
      continue;
    }
    const clockOut = parseUsDateTime(cells[clockOutCol] ?? "");
    if (!clockOut) {
      errors.push(`Row ${line}: couldn't parse "Clocked Out" value "${cells[clockOutCol] ?? ""}" — skipped.`);
      continue;
    }
    if (clockOut.getTime() <= clockIn.getTime()) {
      errors.push(`Row ${line}: "Clocked Out" isn't after "Clocked In" — skipped.`);
      continue;
    }

    rows.push({
      jobName,
      clockIn: clockIn.toISOString(),
      clockOut: clockOut.toISOString(),
      hourlyRateCents: rateCol >= 0 ? parseHourlyRateCents(cells[rateCol] ?? "") : null,
      notes: buildNotes(
        commentCol >= 0 ? (cells[commentCol] ?? "") : "",
        tagsCol >= 0 ? (cells[tagsCol] ?? "") : "",
        adjustmentsCol >= 0 ? (cells[adjustmentsCol] ?? "") : "",
        mileageCol >= 0 ? (cells[mileageCol] ?? "") : "",
      ),
      breaks: breaksCol >= 0 ? parseBreaksField(cells[breaksCol] ?? "", clockIn, clockOut) : [],
    });
  }
  return { rows, errors };
}

// ---------------------------------------------------------------------------
// Grouping/preview logic used by both clients' Import screen — pure (no DB/API calls),
// so it lives here rather than being duplicated per client.
// ---------------------------------------------------------------------------

export interface ImportPreview {
  totalRows: number;
  // Job names in first-seen order, split by whether a job with that exact name already
  // exists — so the UI can say "N new jobs will be created: ..." before anything happens.
  newJobNames: string[];
  existingJobNames: string[];
}

export function buildImportPreview(rows: ParsedImportRow[], existingJobs: Job[]): ImportPreview {
  const existingNames = new Set(existingJobs.map((j) => j.name));
  const seen = new Set<string>();
  const newJobNames: string[] = [];
  const existingJobNames: string[] = [];
  for (const row of rows) {
    if (seen.has(row.jobName)) continue;
    seen.add(row.jobName);
    (existingNames.has(row.jobName) ? existingJobNames : newJobNames).push(row.jobName);
  }
  return { totalRows: rows.length, newJobNames, existingJobNames };
}

// The rate cents value that appears most often among a new job's rows (ties broken by
// whichever was seen first) — used as that job's initial rate when it doesn't already
// exist. An existing job's own rate configuration is never touched by import.
function mostCommonRateCents(rows: ParsedImportRow[]): number | null {
  const counts = new Map<number, number>();
  for (const r of rows) {
    if (r.hourlyRateCents == null) continue;
    counts.set(r.hourlyRateCents, (counts.get(r.hourlyRateCents) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [cents, count] of counts) {
    if (count > bestCount) {
      best = cents;
      bestCount = count;
    }
  }
  return best;
}

// Groups rows by job name (first-seen order) and, for each group, the rate/earliest-date
// pair a brand-new job for that group should be created with — see createJob's own
// comment (both clients) for why the rate version needs to be backdated to `earliestClockIn`
// rather than left effective "now".
export function groupRowsByJob(rows: ParsedImportRow[]): Map<string, { rows: ParsedImportRow[]; rateCents: number | null; earliestClockIn: string }> {
  const byJob = new Map<string, ParsedImportRow[]>();
  for (const row of rows) {
    if (!byJob.has(row.jobName)) byJob.set(row.jobName, []);
    byJob.get(row.jobName)!.push(row);
  }
  const result = new Map<string, { rows: ParsedImportRow[]; rateCents: number | null; earliestClockIn: string }>();
  for (const [jobName, jobRows] of byJob) {
    const earliestClockIn = jobRows.reduce((min, r) => (r.clockIn < min ? r.clockIn : min), jobRows[0].clockIn);
    result.set(jobName, { rows: jobRows, rateCents: mostCommonRateCents(jobRows), earliestClockIn });
  }
  return result;
}
