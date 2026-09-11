import {
  calculateShiftPay,
  formatCents,
  formatClock,
  formatDay,
  formatDuration,
  roundedWorkedMillis,
  startOfDay,
  type Job,
  type Shift,
  type ShiftPay,
} from "@clocker/shared";
import { useMemo, useState } from "react";
import { ShiftEditor } from "../components/ShiftEditor";
import { useStore } from "../store";

const DAYS_BACK = 90;

export function HistoryScreen() {
  const store = useStore();
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectionMode = selectedIds.size > 0;

  const cutoff = useMemo(() => {
    const d = startOfDay(new Date());
    d.setDate(d.getDate() - DAYS_BACK);
    return d.getTime();
  }, []);
  const shifts = useMemo(
    () => store.shifts.filter((s) => new Date(s.clockIn).getTime() >= cutoff).sort((a, b) => (a.clockIn < b.clockIn ? 1 : -1)),
    [store.shifts, cutoff],
  );
  const jobsById = useMemo(() => Object.fromEntries(store.jobs.map((j) => [j.id, j])), [store.jobs]);

  const payByShiftId = useMemo(() => {
    const map = new Map<string, ShiftPay>();
    const shiftsByJob = new Map<string, Shift[]>();
    for (const s of shifts) {
      if (!shiftsByJob.has(s.jobId)) shiftsByJob.set(s.jobId, []);
      shiftsByJob.get(s.jobId)!.push(s);
    }
    for (const [jobId, jobShifts] of shiftsByJob) {
      const job: Job | undefined = jobsById[jobId];
      if (!job) continue;
      const jobTiers = store.rateTiers.filter((t) => t.jobId === jobId);
      const tierIds = new Set(jobTiers.map((t) => t.id));
      const jobVersions = store.rateVersions.filter((v) => tierIds.has(v.tierId));
      const shiftsWithHours = jobShifts.map((s) => ({
        shift: s,
        workedHours: roundedWorkedMillis(s, store.breaks.filter((b) => b.shiftId === s.id), job) / 3_600_000,
      }));
      for (const pay of calculateShiftPay({ job, tiers: jobTiers, versions: jobVersions, shiftsWithHours })) {
        map.set(pay.shiftId, pay);
      }
    }
    return map;
  }, [shifts, jobsById, store.rateTiers, store.rateVersions, store.breaks]);

  const sections = useMemo(() => {
    const byDay = new Map<string, Shift[]>();
    for (const shift of shifts) {
      const key = startOfDay(new Date(shift.clockIn)).toISOString();
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(shift);
    }
    return Array.from(byDay.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, dayShifts]) => {
        const totalMs = dayShifts.reduce(
          (sum, s) => sum + roundedWorkedMillis(s, store.breaks.filter((b) => b.shiftId === s.id), jobsById[s.jobId]),
          0,
        );
        return { day, title: `${formatDay(day)} — ${formatDuration(totalMs)}`, shifts: dayShifts };
      });
  }, [shifts, store.breaks, jobsById]);

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirmDelete(shift: Shift) {
    if (window.confirm("Delete this shift? This can't be undone.")) store.deleteShift(shift);
  }

  function confirmDeleteSelected() {
    const count = selectedIds.size;
    if (window.confirm(`Delete ${count} shift${count === 1 ? "" : "s"}? This can't be undone.`)) {
      store.deleteShifts(shifts.filter((s) => selectedIds.has(s.id)));
      setSelectedIds(new Set());
    }
  }

  return (
    <div className="screen">
      {selectionMode && (
        <div className="selection-bar">
          <button className="link-button" onClick={() => setSelectedIds(new Set())}>
            Cancel
          </button>
          <span className="selection-count">{selectedIds.size} selected</span>
          <button className="link-button" onClick={() => setSelectedIds(new Set(shifts.map((s) => s.id)))}>
            Select All
          </button>
          <button className="link-button danger" onClick={confirmDeleteSelected}>
            Delete
          </button>
        </div>
      )}

      {shifts.length === 0 && <p className="muted">No shifts in the last {DAYS_BACK} days.</p>}

      {sections.map((section) => (
        <div key={section.day}>
          <h4 className="section-header">{section.title}</h4>
          {section.shifts.map((shift) => {
            const job = jobsById[shift.jobId];
            const shiftBreaks = store.breaks.filter((b) => b.shiftId === shift.id);
            const worked = roundedWorkedMillis(shift, shiftBreaks, job);
            const pay = payByShiftId.get(shift.id);
            const selected = selectedIds.has(shift.id);
            return (
              <div
                key={shift.id}
                className={`row clickable${selected ? " selected" : ""}`}
                onClick={() => (selectionMode ? toggleSelected(shift.id) : setEditingShift(shift))}
              >
                {selectionMode && <input type="checkbox" checked={selected} readOnly />}
                <span className="dot" style={{ backgroundColor: job?.colorHex ?? "#999" }} />
                <div className="row-main">
                  <div className="row-title">{job?.name ?? "Deleted job"}</div>
                  <div className="row-subtitle">
                    {formatClock(shift.clockIn)} – {shift.clockOut ? formatClock(shift.clockOut) : "in progress"}
                    {shiftBreaks.length > 0 ? ` · ${shiftBreaks.length} break${shiftBreaks.length > 1 ? "s" : ""}` : ""}
                  </div>
                  {shift.notes && <div className="notes-preview">{shift.notes}</div>}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="duration">{formatDuration(worked)}</div>
                  {pay && pay.rateCentsPerHour != null && <div className="pay">{formatCents(pay.totalCents)}</div>}
                </div>
                <button
                  className="link-button muted"
                  onClick={(e) => {
                    e.stopPropagation();
                    confirmDelete(shift);
                  }}
                >
                  Delete
                </button>
              </div>
            );
          })}
        </div>
      ))}

      {editingShift && <ShiftEditor shift={editingShift} onClose={() => setEditingShift(null)} />}
    </div>
  );
}
