import {
  addDays,
  buildCsv,
  buildPlainText,
  formatDuration,
  groupShiftsByJob,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "@clocker/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { downloadText } from "../lib/download";

type RangeKey = "thisWeek" | "lastWeek" | "thisMonth" | "last90" | "custom";
const RANGES: { key: RangeKey; label: string }[] = [
  { key: "thisWeek", label: "This Week" },
  { key: "lastWeek", label: "Last Week" },
  { key: "thisMonth", label: "This Month" },
  { key: "last90", label: "Last 90 Days" },
  { key: "custom", label: "Custom Range" },
];

// `custom` is handled separately (needs the user-picked start/end state) — every other
// key is a pure function of "today".
function rangeFor(key: Exclude<RangeKey, "custom">): { start: Date; end: Date; label: string } {
  const today = new Date();
  switch (key) {
    case "thisWeek": {
      const start = startOfWeek(today);
      return { start, end: addDays(start, 7), label: `Week of ${start.toLocaleDateString()}` };
    }
    case "lastWeek": {
      const start = addDays(startOfWeek(today), -7);
      return { start, end: addDays(start, 7), label: `Week of ${start.toLocaleDateString()}` };
    }
    case "thisMonth": {
      const start = startOfMonth(today);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      return { start, end, label: start.toLocaleDateString([], { month: "long", year: "numeric" }) };
    }
    case "last90": {
      const start = addDays(startOfDay(today), -90);
      return { start, end: addDays(startOfDay(today), 1), label: "Last 90 days" };
    }
  }
}

function defaultSubject(rangeLabel: string, jobName: string | null): string {
  return jobName ? `${jobName} Hours — ${rangeLabel}` : `Hours — ${rangeLabel}`;
}

// <input type="date"> works in the browser's local timezone via plain "YYYY-MM-DD"
// strings — going through Date/toISOString would shift the value by the UTC offset.
function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function fromDateInputValue(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// mailto: bodies get silently truncated by some mail clients past roughly this length —
// past it, skip prefilling the body and rely on the clipboard copy instead (see below).
const MAILTO_BODY_LIMIT = 1500;

export function ExportScreen() {
  const store = useStore();
  // Defaults to every job selected once jobs first load (see the effect below) — after
  // that it's purely user-driven, including a job added later is a deliberate choice via
  // Select All or its own chip, not an automatic side effect of adding it.
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const didInitJobFilter = useRef(false);
  const [rangeKey, setRangeKey] = useState<RangeKey>("thisWeek");
  const [recipients, setRecipients] = useState("");
  const [subject, setSubject] = useState("");
  const [subjectEdited, setSubjectEdited] = useState(false);
  const [includeEarnings, setIncludeEarnings] = useState(true);
  const [includeComments, setIncludeComments] = useState(true);
  const [includeTimes, setIncludeTimes] = useState(true);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [customStart, setCustomStart] = useState(() => startOfDay(new Date()));
  const [customEnd, setCustomEnd] = useState(() => startOfDay(new Date()));

  const range = useMemo(() => {
    if (rangeKey === "custom") {
      const start = customStart;
      const end = addDays(customEnd, 1);
      const label = start.getTime() === customEnd.getTime() ? start.toLocaleDateString() : `${start.toLocaleDateString()} – ${customEnd.toLocaleDateString()}`;
      return { start, end, label };
    }
    return rangeFor(rangeKey);
  }, [rangeKey, customStart, customEnd]);
  const jobsById = useMemo(() => Object.fromEntries(store.jobs.map((j) => [j.id, j])), [store.jobs]);

  useEffect(() => {
    if (!didInitJobFilter.current && store.jobs.length > 0) {
      setSelectedJobIds(new Set(store.jobs.map((j) => j.id)));
      didInitJobFilter.current = true;
    }
  }, [store.jobs]);

  function toggleJob(id: string) {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const shifts = useMemo(
    () =>
      store.shifts.filter((s) => {
        const t = new Date(s.clockIn).getTime();
        if (t < range.start.getTime() || t >= range.end.getTime()) return false;
        return selectedJobIds.has(s.jobId);
      }),
    [store.shifts, range, selectedJobIds],
  );
  const breaksByShift = useMemo(() => {
    const grouped: Record<string, typeof store.breaks> = {};
    for (const b of store.breaks) (grouped[b.shiftId] ??= []).push(b);
    return grouped;
  }, [store.breaks]);

  const { groups, payByShiftId } = useMemo(
    () => groupShiftsByJob({ shifts, jobsById, tiers: store.rateTiers, versions: store.rateVersions, breaksByShift }),
    [shifts, jobsById, store.rateTiers, store.rateVersions, breaksByShift],
  );
  const totalHours = groups.reduce((sum, g) => sum + g.totalHours, 0);

  useEffect(() => {
    if (subjectEdited) return;
    // Only name a specific job in the default subject when exactly one is selected —
    // "all of them" or "some arbitrary subset" both read better as the generic label.
    const selected = store.jobs.filter((j) => selectedJobIds.has(j.id));
    const jobName = selected.length === 1 ? selected[0].name : null;
    setSubject(defaultSubject(range.label, jobName));
  }, [range, selectedJobIds, store.jobs, subjectEdited]);

  function exportCsv() {
    if (shifts.length === 0) {
      alert("There are no shifts in this range.");
      return;
    }
    const csv = buildCsv(groups, payByShiftId, breaksByShift);
    downloadText(csv, `clocker-export-${Date.now()}.csv`, "text/csv");
  }

  async function emailDraft() {
    if (shifts.length === 0) {
      alert("There are no shifts in this range.");
      return;
    }
    const text = buildPlainText({ groups, payByShiftId, breaksByShift, rangeLabel: range.label, options: { includeEarnings, includeComments, includeTimes } });
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      // Clipboard access denied/unavailable — the mailto link below is still useful on
      // its own, just without a pre-filled body if it's over the length limit.
    }
    const recipientList = recipients
      .split(/[,\s]+/)
      .map((r) => r.trim())
      .filter(Boolean);
    const mailtoBody = text.length <= MAILTO_BODY_LIMIT ? text : "";
    const url = `mailto:${recipientList.join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(mailtoBody)}`;
    window.location.href = url;
    setCopyStatus(
      copied
        ? mailtoBody
          ? "Opened your mail app with the timesheet pre-filled, and copied it to your clipboard too."
          : "Copied the timesheet to your clipboard — paste it into the email that just opened (too long to pre-fill automatically)."
        : "Opened your mail app. Couldn't copy to clipboard automatically — copy the text below manually if needed.",
    );
  }

  return (
    <div className="screen">
      <h3>Range</h3>
      <div className="chip-row">
        {RANGES.map((r) => (
          <button key={r.key} className={`chip${rangeKey === r.key ? " selected" : ""}`} onClick={() => setRangeKey(r.key)}>
            {r.label}
          </button>
        ))}
      </div>

      {rangeKey === "custom" && (
        <div className="custom-range-row">
          <label>
            Start
            <input
              type="date"
              value={toDateInputValue(customStart)}
              max={toDateInputValue(customEnd)}
              onChange={(e) => e.target.value && setCustomStart(fromDateInputValue(e.target.value))}
            />
          </label>
          <label>
            End
            <input
              type="date"
              value={toDateInputValue(customEnd)}
              min={toDateInputValue(customStart)}
              onChange={(e) => e.target.value && setCustomEnd(fromDateInputValue(e.target.value))}
            />
          </label>
        </div>
      )}

      <div className="section-header-row">
        <h3>Job</h3>
        <div className="header-row-actions">
          <button className="link" onClick={() => setSelectedJobIds(new Set(store.jobs.map((j) => j.id)))}>
            Select All
          </button>
          <span className="link-separator">·</span>
          <button className="link" onClick={() => setSelectedJobIds(new Set())}>
            Deselect All
          </button>
        </div>
      </div>
      <div className="chip-row">
        {store.jobs.map((job) => (
          <button key={job.id} className={`chip${selectedJobIds.has(job.id) ? " selected" : ""}`} onClick={() => toggleJob(job.id)}>
            {job.name}
          </button>
        ))}
        {store.jobs.length === 0 && <p className="hint">Add a job in the Jobs tab first.</p>}
      </div>

      <div className="totals-row">
        <span className="muted">
          {shifts.length} shift{shifts.length === 1 ? "" : "s"}
        </span>
        <span className="totals-hours">{formatDuration(totalHours * 3_600_000)}</span>
      </div>

      <button className="primary-button" onClick={exportCsv}>
        Download CSV
      </button>

      <hr />

      <h3>Email a draft</h3>
      <p className="hint">
        No native mail app here — this copies a formatted, plain-text timesheet to your clipboard and opens a{" "}
        <code>mailto:</code> link with your default mail app. Paste if the body doesn't come through pre-filled (mail clients
        vary, and very long timesheets don't fit in a mailto link).
      </p>
      <input placeholder="Email to (comma-separated)" value={recipients} onChange={(e) => setRecipients(e.target.value)} />
      <input
        placeholder="Subject"
        value={subject}
        onChange={(e) => {
          setSubject(e.target.value);
          setSubjectEdited(true);
        }}
      />

      <div className="switch-row">
        <span>Include earnings</span>
        <label className="switch">
          <input type="checkbox" checked={includeEarnings} onChange={(e) => setIncludeEarnings(e.target.checked)} />
          <span className="switch-track" />
        </label>
      </div>
      <div className="switch-row">
        <span>Include comments</span>
        <label className="switch">
          <input type="checkbox" checked={includeComments} onChange={(e) => setIncludeComments(e.target.checked)} />
          <span className="switch-track" />
        </label>
      </div>
      <div className="switch-row">
        <span>Include start/end times</span>
        <label className="switch">
          <input type="checkbox" checked={includeTimes} onChange={(e) => setIncludeTimes(e.target.checked)} />
          <span className="switch-track" />
        </label>
      </div>

      <button className="primary-button email-button" onClick={emailDraft}>
        Create Email Draft
      </button>
      {copyStatus && <p className="hint">{copyStatus}</p>}
    </div>
  );
}
