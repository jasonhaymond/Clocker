import { calculateShiftPay, calculateWeeklyProgress, formatCents, formatClock, formatDuration, workedMillis, type Break, type Job, type Shift } from "@clocker/shared";
import { useEffect, useState } from "react";
import { ShiftNotesModal } from "../components/ShiftNotesModal";
import { useDateTimePrompt } from "../lib/useDateTimePrompt";
import { useStore } from "../store";

export function ClockScreen() {
  const store = useStore();
  const { prompt, modal } = useDateTimePrompt();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [notesPromptShift, setNotesPromptShift] = useState<Shift | null>(null);

  const openShifts = store.shifts.filter((s) => !s.clockOut);
  const openJobIds = new Set(openShifts.map((s) => s.jobId));
  const availableJobs = store.jobs.filter((j) => !j.archived && !openJobIds.has(j.id));

  useEffect(() => {
    if (selectedJobId && availableJobs.some((j) => j.id === selectedJobId)) return;
    setSelectedJobId(availableJobs[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableJobs.map((j) => j.id).join(",")]);

  const tiers = selectedJobId ? store.rateTiers.filter((t) => t.jobId === selectedJobId && !t.archived) : [];
  useEffect(() => {
    setSelectedTierId(tiers.find((t) => t.isDefault)?.id ?? tiers[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJobId]);

  useEffect(() => {
    if (openShifts.length === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [openShifts.length]);

  function openBreakFor(shiftId: string): Break | undefined {
    return store.breaks.find((b) => b.shiftId === shiftId && !b.end);
  }

  // The web store already holds every shift/break in memory (no local DB to query), so no
  // extra data loading is needed here — calculateWeeklyProgress does its own week
  // filtering from whatever's passed in.
  function weeklyProgressFor(job: Job | null) {
    if (!job || job.expectedWeeklyHours == null) return null;
    const jobShifts = store.shifts.filter((s) => s.jobId === job.id);
    const breaksByShift: Record<string, Break[]> = {};
    for (const b of store.breaks) (breaksByShift[b.shiftId] ??= []).push(b);
    return calculateWeeklyProgress({ job, shifts: jobShifts, breaksByShift });
  }

  // Live pay for a still-open shift — the same calculation History/Timesheets/Export use
  // for closed ones, just fed the shift's currently-elapsed hours so it counts up
  // alongside the timer instead of a fixed final duration.
  function payFor(shift: Shift, job: Job | null, worked: number): { cents: number; hasRate: boolean } | null {
    if (!job) return null;
    const jobTiers = store.rateTiers.filter((t) => t.jobId === job.id);
    if (jobTiers.length === 0) return null;
    const [pay] = calculateShiftPay({
      job,
      tiers: jobTiers,
      versions: store.rateVersions,
      shiftsWithHours: [{ shift, workedHours: worked / 3_600_000 }],
    });
    return pay ? { cents: pay.totalCents, hasRate: pay.rateCentsPerHour != null } : null;
  }

  async function handleClockIn(customTime?: Date) {
    if (!selectedJobId) return;
    const tierId = tiers.length > 1 ? selectedTierId : null;
    await store.clockIn(selectedJobId, tierId, customTime?.toISOString());
  }

  async function handleClockInAt() {
    const date = await prompt(new Date(), "Clock In At");
    if (date) handleClockIn(date);
  }

  async function handleClockOut(shift: Shift, customTime?: Date) {
    await store.clockOut(shift, customTime?.toISOString());
    const job = store.jobs.find((j) => j.id === shift.jobId);
    if (job?.promptForNotesOnClockOut) setNotesPromptShift(shift);
  }

  async function handleClockOutAt(shift: Shift) {
    const date = await prompt(new Date(), "Clock Out At");
    if (!date) return;
    if (date.getTime() <= new Date(shift.clockIn).getTime()) {
      alert("Clock-out must be after clock-in.");
      return;
    }
    handleClockOut(shift, date);
  }

  async function handleStartBreak(shift: Shift, customTime?: Date) {
    if (customTime && customTime.getTime() < new Date(shift.clockIn).getTime()) {
      alert("A break can't start before the shift's clock-in.");
      return;
    }
    await store.startBreak(shift.id, customTime?.toISOString());
  }

  async function handleStartBreakAt(shift: Shift) {
    const date = await prompt(new Date(), "Start Break At");
    if (date) handleStartBreak(shift, date);
  }

  async function handleEndBreak(openBreak: Break, customTime?: Date) {
    if (customTime && customTime.getTime() <= new Date(openBreak.start).getTime()) {
      alert("Break end must be after it started.");
      return;
    }
    await store.endBreak(openBreak, customTime?.toISOString());
  }

  async function handleEndBreakAt(openBreak: Break) {
    const date = await prompt(new Date(), "End Break At");
    if (date) handleEndBreak(openBreak, date);
  }

  return (
    <div className="screen">
      {openShifts.map((shift) => {
        const job = store.jobs.find((j) => j.id === shift.jobId) ?? null;
        const shiftBreaks = store.breaks.filter((b) => b.shiftId === shift.id);
        const openBreak = openBreakFor(shift.id);
        const worked = workedMillis(shift, shiftBreaks);
        const progress = weeklyProgressFor(job);
        const pay = payFor(shift, job, worked);
        return (
          <div key={shift.id} className="clock-card">
            <span className="job-badge" style={{ backgroundColor: job?.colorHex ?? "#2563eb" }}>
              {job?.name ?? "Job"}
            </span>
            <div className="clock-timer">{formatDuration(worked)}</div>
            {pay?.hasRate && <div className="clock-earnings">{formatCents(pay.cents)} so far</div>}
            <div className="clock-since">Since {formatClock(shift.clockIn)}</div>
            {openBreak && <div className="clock-on-break">On break since {formatClock(openBreak.start)}</div>}
            {progress && (
              <div className="clock-weekly-progress">
                {progress.remainingMinutes > 0
                  ? `${formatDuration(progress.remainingMinutes * 60_000)} left this week`
                  : "Weekly target reached"}
                {progress.expectedClockOut && progress.remainingMinutes > 0
                  ? ` — expected out ${formatClock(progress.expectedClockOut.toISOString())}`
                  : ""}
              </div>
            )}

            <div className="split-row">
              <button
                className={`big-button flex-button ${openBreak ? "resume" : "break"}`}
                onClick={() => (openBreak ? handleEndBreak(openBreak) : handleStartBreak(shift))}
              >
                {openBreak ? "End Break" : "Start Break"}
              </button>
              <button className="at-button" onClick={() => (openBreak ? handleEndBreakAt(openBreak) : handleStartBreakAt(shift))}>
                At...
              </button>
            </div>
            <div className="split-row">
              <button className="big-button flex-button clock-out" onClick={() => handleClockOut(shift)}>
                Clock Out
              </button>
              <button className="at-button" onClick={() => handleClockOutAt(shift)}>
                At...
              </button>
            </div>
          </div>
        );
      })}

      <div className="clock-new-shift">
        <p className="label">{openShifts.length > 0 ? "Clock into another job" : "Select a job"}</p>
        <div className="job-picker">
          {availableJobs.map((job) => (
            <button
              key={job.id}
              className={`job-option${selectedJobId === job.id ? " selected" : ""}`}
              style={{ borderColor: job.colorHex, backgroundColor: selectedJobId === job.id ? job.colorHex : undefined }}
              onClick={() => setSelectedJobId(job.id)}
            >
              {job.name}
            </button>
          ))}
          {store.jobs.length === 0 && <p className="muted">Add a job in the Jobs tab first.</p>}
          {store.jobs.length > 0 && availableJobs.length === 0 && <p className="muted">Already clocked into every job.</p>}
        </div>

        {tiers.length > 1 && (
          <>
            <p className="label">Which rate?</p>
            <div className="job-picker">
              {tiers.map((tier) => (
                <button
                  key={tier.id}
                  className={`job-option tier-option${selectedTierId === tier.id ? " selected" : ""}`}
                  onClick={() => setSelectedTierId(tier.id)}
                >
                  {tier.name}
                </button>
              ))}
            </div>
          </>
        )}

        {availableJobs.length > 0 && (
          <>
            {(() => {
              // Deliberately just the remaining-hours figure here, not expectedClockOut —
              // "expected clock-out" only means something once you're actually on the
              // clock; showing it before you've clocked in would read as a prediction
              // this screen has no basis for yet.
              const selectedJob = store.jobs.find((j) => j.id === selectedJobId) ?? null;
              const progress = weeklyProgressFor(selectedJob);
              if (!progress) return null;
              return (
                <div className="clock-weekly-progress">
                  {progress.remainingMinutes > 0
                    ? `${formatDuration(progress.remainingMinutes * 60_000)} left this week`
                    : "Weekly target reached"}
                </div>
              );
            })()}
            <div className="split-row" style={{ maxWidth: 360, margin: "0 auto" }}>
              <button className="big-button flex-button clock-in" onClick={() => handleClockIn()} disabled={!selectedJobId}>
                Clock In Now
              </button>
              <button className="at-button" onClick={handleClockInAt} disabled={!selectedJobId}>
                Start At...
              </button>
            </div>
          </>
        )}
      </div>

      {modal}
      {notesPromptShift && <ShiftNotesModal shift={notesPromptShift} onClose={() => setNotesPromptShift(null)} />}
    </div>
  );
}
