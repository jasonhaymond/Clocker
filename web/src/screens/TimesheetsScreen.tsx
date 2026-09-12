import {
  buildCsv,
  buildPlainText,
  formatCents,
  formatClock,
  formatDay,
  formatDuration,
  groupShiftsByJob,
  jobPeriodSettings,
  periodContaining,
  roundedWorkedMillis,
  shiftPeriod,
  type Period,
} from "@clocker/shared";
import { useEffect, useMemo, useState } from "react";
import { JobEditor } from "../components/JobEditor";
import { downloadText } from "../lib/download";
import { useStore } from "../store";

export function TimesheetsScreen() {
  const store = useStore();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period | null>(null);
  const [editingJob, setEditingJob] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Archived jobs are hidden everywhere except the Jobs screen itself — not selectable
  // here, matching Export/History's own job checklists.
  const activeJobs = useMemo(() => store.jobs.filter((j) => !j.archived), [store.jobs]);

  useEffect(() => {
    if (selectedJobId && activeJobs.some((j) => j.id === selectedJobId)) return;
    setSelectedJobId(activeJobs[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobs.map((j) => j.id).join(",")]);

  const job = store.jobs.find((j) => j.id === selectedJobId) ?? null;

  useEffect(() => {
    if (job) setPeriod(periodContaining(new Date(), jobPeriodSettings(job)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

  const shifts = useMemo(() => {
    if (!job || !period) return [];
    return store.shifts.filter((s) => s.jobId === job.id && s.clockIn >= period.start.toISOString() && s.clockIn < period.end.toISOString());
  }, [store.shifts, job, period]);
  const breaksByShift = useMemo(() => {
    const grouped: Record<string, typeof store.breaks> = {};
    for (const b of store.breaks) (grouped[b.shiftId] ??= []).push(b);
    return grouped;
  }, [store.breaks]);
  const jobsById = useMemo(() => (job ? { [job.id]: job } : {}), [job]);
  const { groups, payByShiftId } = useMemo(
    () => groupShiftsByJob({ shifts, jobsById, tiers: store.rateTiers, versions: store.rateVersions, breaksByShift }),
    [shifts, jobsById, store.rateTiers, store.rateVersions, breaksByShift],
  );
  const group = groups[0];
  const totalHours = group?.totalHours ?? 0;
  const totalCents = group?.totalCents ?? 0;

  function goToPeriod(offset: number) {
    if (!period || !job) return;
    setPeriod(shiftPeriod(period, jobPeriodSettings(job), offset));
  }

  async function submitTimesheet() {
    if (!job || !period) return;
    setStatus(null);
    if (shifts.length === 0) {
      alert("There are no shifts in this period.");
      return;
    }
    const assignments = store.jobManagers.filter((jm) => jm.jobId === job.id);
    if (assignments.length === 0) {
      if (window.confirm("No recipients configured for this job. Open its settings to assign a manager?")) setEditingJob(true);
      return;
    }
    const recipients = store.managers.filter((m) => assignments.some((a) => a.managerId === m.id) && !m.archived).map((m) => m.email);
    if (recipients.length === 0) {
      alert("The managers assigned to this job are archived. Update this job's settings.");
      return;
    }

    const messages: string[] = [];
    if (job.timesheetFormat === "csv" || job.timesheetFormat === "both") {
      const csv = buildCsv(groups, payByShiftId, breaksByShift);
      downloadText(csv, `timesheet-${job.name.replace(/\s+/g, "-")}-${Date.now()}.csv`, "text/csv");
      messages.push("Downloaded the CSV — attach it to the email that opens.");
    }
    let mailtoBody = "";
    if (job.timesheetFormat === "text" || job.timesheetFormat === "both") {
      const text = buildPlainText({
        groups,
        payByShiftId,
        breaksByShift,
        rangeLabel: period.label,
        options: {
          includeEarnings: job.timesheetIncludeEarnings,
          includeComments: job.timesheetIncludeNotes,
          includeTimes: job.timesheetIncludeTimes,
        },
      });
      try {
        await navigator.clipboard.writeText(text);
        messages.push("Copied the formatted timesheet to your clipboard.");
      } catch {
        // Best-effort — fall through to the mailto link either way.
      }
      if (text.length <= 1500) mailtoBody = text;
    }

    const subject = `${job.name} Timesheet — ${period.label}`;
    window.location.href = `mailto:${recipients.join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(mailtoBody)}`;
    messages.push("Opened your mail app.");
    setStatus(messages.join(" "));
  }

  if (activeJobs.length === 0) {
    return (
      <div className="screen">
        <p className="muted">{store.jobs.length > 0 ? "No active jobs — archived jobs aren't shown here." : "Add a job in the Jobs tab first."}</p>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="chip-row">
        {activeJobs.map((j) => (
          <button
            key={j.id}
            className={`chip job-chip${selectedJobId === j.id ? " selected" : ""}`}
            style={selectedJobId === j.id ? { backgroundColor: j.colorHex, borderColor: j.colorHex } : { borderColor: j.colorHex }}
            onClick={() => setSelectedJobId(j.id)}
          >
            {j.name}
          </button>
        ))}
      </div>

      {job && period && (
        <>
          <div className="period-bar">
            <button className="link-button" onClick={() => goToPeriod(-1)}>
              ← Prev
            </button>
            <span className="period-label">{period.label}</span>
            <button className="link-button" onClick={() => goToPeriod(1)}>
              Next →
            </button>
            <button className="link-button" onClick={() => setEditingJob(true)}>
              ⚙ Settings
            </button>
          </div>

          <div className="totals-row centered">
            <span className="totals-hours-large">{formatDuration(totalHours * 3_600_000)}</span>
            {job.timesheetIncludeEarnings && group?.hasRate && <span className="totals-pay">{formatCents(totalCents)}</span>}
          </div>

          {!group && <p className="muted">No shifts in this period.</p>}
          {group?.shifts.map((shift) => {
            const worked = roundedWorkedMillis(shift, breaksByShift[shift.id] ?? [], job) / 3_600_000;
            return (
              <div key={shift.id} className="entry-row">
                <span className="entry-day">{formatDay(shift.clockIn)}</span>
                {job.timesheetIncludeTimes && (
                  <span className="entry-times">
                    {formatClock(shift.clockIn)} – {shift.clockOut ? formatClock(shift.clockOut) : "in progress"}
                  </span>
                )}
                <span className="entry-hours">{worked.toFixed(2)}h</span>
                {job.timesheetIncludeNotes && shift.notes ? <span className="entry-notes">{shift.notes}</span> : null}
              </div>
            );
          })}

          <button className="primary-button submit-button" onClick={submitTimesheet}>
            Submit Timesheet
          </button>
          {status && <p className="hint">{status}</p>}
        </>
      )}

      {editingJob && job && <JobEditor job={job} onClose={() => setEditingJob(false)} />}
    </div>
  );
}
