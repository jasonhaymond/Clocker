import {
  addDays,
  calculateShiftPay,
  formatCents,
  formatClock,
  formatDay,
  formatDuration,
  RANGES,
  rangeFor,
  roundedWorkedMillis,
  startOfDay,
  type Job,
  type RangeKey,
  type Shift,
  type ShiftPay,
} from "@clocker/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { IoTrashOutline } from "react-icons/io5";
import { ShiftEditor } from "../components/ShiftEditor";
import { useStore } from "../store";

// <input type="date"> works in the browser's local timezone via plain "YYYY-MM-DD"
// strings — going through Date/toISOString would shift the value by the UTC offset.
// Same helpers as ExportScreen's own custom-range inputs.
function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function fromDateInputValue(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const LONG_PRESS_MS = 500;
// How far a pointer can drift while held before it counts as a scroll/drag rather than a
// long press, in CSS pixels. Also used to distinguish an intentional horizontal swipe
// from a stationary press.
const LONG_PRESS_MOVE_TOLERANCE = 10;
const SWIPE_ACTION_WIDTH = 72;
// How far left a row must be dragged before releasing it snaps to fully open rather than
// springing back closed.
const SWIPE_OPEN_THRESHOLD = 40;

export function HistoryScreen() {
  const store = useStore();
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectionMode = selectedIds.size > 0;

  const [showFilters, setShowFilters] = useState(false);
  const [rangeKey, setRangeKey] = useState<RangeKey>("last90");
  const [customStart, setCustomStart] = useState(() => startOfDay(new Date()));
  const [customEnd, setCustomEnd] = useState(() => startOfDay(new Date()));
  // Defaults to every job selected once jobs first load — after that it's purely
  // user-driven, same convention as Export's own job filter (a job added later doesn't
  // silently join an already-customized selection).
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const didInitJobFilter = useRef(false);

  const range = useMemo(() => {
    if (rangeKey === "custom") {
      const start = customStart;
      const end = addDays(customEnd, 1);
      const label = start.getTime() === customEnd.getTime() ? start.toLocaleDateString() : `${start.toLocaleDateString()} – ${customEnd.toLocaleDateString()}`;
      return { start, end, label };
    }
    return rangeFor(rangeKey);
  }, [rangeKey, customStart, customEnd]);

  // Archived jobs are hidden everywhere except the Jobs screen itself — not offered as a
  // filter option here, same as Export's own job checklist.
  const activeJobs = useMemo(() => store.jobs.filter((j) => !j.archived), [store.jobs]);

  useEffect(() => {
    if (!didInitJobFilter.current && activeJobs.length > 0) {
      setSelectedJobIds(new Set(activeJobs.map((j) => j.id)));
      didInitJobFilter.current = true;
    }
  }, [activeJobs]);

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
      store.shifts
        .filter((s) => {
          const t = new Date(s.clockIn).getTime();
          if (t < range.start.getTime() || t >= range.end.getTime()) return false;
          return selectedJobIds.has(s.jobId);
        })
        .sort((a, b) => (a.clockIn < b.clockIn ? 1 : -1)),
    [store.shifts, range, selectedJobIds],
  );
  const jobsById = useMemo(() => Object.fromEntries(store.jobs.map((j) => [j.id, j])), [store.jobs]);

  // A shift selected for bulk-delete that a filter change just hid from view would
  // otherwise leave the selection count silently out of sync with what's visible (and
  // what confirmDeleteSelected would actually delete, since that reads from the
  // already-filtered `shifts` array) — clearing on every filter change keeps them in sync.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [range, selectedJobIds]);

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

  // Total across everything currently loaded (the last DAYS_BACK days) — only counts
  // shifts that actually resolved to a real rate, same condition each row already checks
  // before showing its own pay figure.
  const totalCents = useMemo(() => {
    let sum = 0;
    for (const pay of payByShiftId.values()) {
      if (pay.rateCentsPerHour != null) sum += pay.totalCents;
    }
    return sum;
  }, [payByShiftId]);

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

  // Which row (if any) currently has its swipe-revealed delete action open. Only ever
  // one at a time — starting a new swipe, or tapping anywhere else, closes it.
  const [swipedId, setSwipedId] = useState<string | null>(null);
  // The actively-dragging row's live offset, while a swipe gesture is in progress (not
  // yet released). Separate from swipedId, which only reflects the *settled* state.
  const [dragState, setDragState] = useState<{ id: string; dx: number } | null>(null);

  // There was previously no way to ENTER selection mode at all here — nothing ever set
  // selectedIds to non-empty except actions that already require selection mode to be
  // active. Pointer Events (not separate mouse/touch handlers) so one implementation
  // covers mouse, touch, and pen alike — long-press-with-mouse works the same as
  // long-press-with-touch, matching the mobile app's onLongPress for entering selection.
  // The same pointer stream also now drives swipe-to-delete: a mostly-horizontal drag
  // past the move tolerance switches from "maybe a long press" to "definitely a swipe"
  // and cancels the long-press timer, matching how a real touch UI disambiguates the two.
  const press = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    id: string | null;
    x: number;
    y: number;
    fired: boolean;
    swiping: boolean;
    dismissedSwipe: boolean;
  }>({
    timer: null,
    id: null,
    x: 0,
    y: 0,
    fired: false,
    swiping: false,
    dismissedSwipe: false,
  });

  function clearPressTimer() {
    if (press.current.timer != null) {
      clearTimeout(press.current.timer);
      press.current.timer = null;
    }
  }

  function onRowPointerDown(e: React.PointerEvent, id: string) {
    // Right-click / non-primary buttons shouldn't start a long-press or a swipe.
    if (e.button !== 0) return;
    // Starting a fresh gesture on any row closes whatever was previously swiped open —
    // standard behavior for this pattern (tap/drag elsewhere dismisses it). Recorded here
    // (checked and cleared in onRowClick, same reasoning as `fired`/`swiping` below) so
    // that dismissal *replaces* this click's normal action instead of merely happening
    // alongside it — otherwise tapping a different row while one is swiped open would
    // both close the swipe AND open that row's editor in the same tap.
    press.current.dismissedSwipe = swipedId !== null && swipedId !== id;
    if (press.current.dismissedSwipe) setSwipedId(null);
    // Explicit capture so a drag that moves outside this row's box (finger/mouse
    // slipping up or down slightly while swiping) still delivers its move/up events
    // here instead of wherever the pointer physically ends up.
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current.id = id;
    press.current.x = e.clientX;
    press.current.y = e.clientY;
    press.current.fired = false;
    press.current.swiping = false;
    clearPressTimer();
    press.current.timer = setTimeout(() => {
      press.current.fired = true;
      toggleSelected(id);
    }, LONG_PRESS_MS);
  }

  function onRowPointerMove(e: React.PointerEvent, id: string) {
    if (press.current.id !== id) return;
    const dx = e.clientX - press.current.x;
    const dy = e.clientY - press.current.y;
    if (!press.current.swiping) {
      if (Math.hypot(dx, dy) <= LONG_PRESS_MOVE_TOLERANCE) return;
      clearPressTimer();
      // Only commit to a swipe if the drag is predominantly horizontal — a vertical
      // drag here is a page scroll, which should be left alone entirely.
      if (Math.abs(dx) <= Math.abs(dy)) return;
      press.current.swiping = true;
    }
    // Only swiping leftward (revealing a right-side action) is supported; block any
    // rightward drag from opening rather than letting it push the row past 0.
    setDragState({ id, dx: Math.max(-SWIPE_ACTION_WIDTH, Math.min(0, dx)) });
  }

  function onRowPointerUp(id: string) {
    clearPressTimer();
    // Deliberately does NOT reset press.current.swiping here — pointerup fires before
    // the click event that follows it, and onRowClick below needs to see this gesture
    // was a swipe (the same reason `fired` is only ever cleared there, not here).
    if (press.current.swiping && press.current.id === id) {
      const finalDx = dragState?.id === id ? dragState.dx : 0;
      setSwipedId(finalDx <= -SWIPE_OPEN_THRESHOLD ? id : null);
    }
    setDragState(null);
  }

  // A genuine cancel (browser takes over for something else) or the pointer leaving the
  // row's box mid-drag — abort back to closed rather than committing an open, unlike a
  // real pointerup which judges the final position.
  function onRowPointerLeaveOrCancel(id: string) {
    clearPressTimer();
    if (dragState?.id === id) setDragState(null);
  }

  function onRowClick(shift: Shift) {
    // Swallow the click that a long-press's or a swipe's pointerup still generates —
    // without this, either gesture would also open the shift editor in the same motion.
    if (press.current.fired || press.current.swiping) {
      press.current.fired = false;
      press.current.swiping = false;
      return;
    }
    // This tap already dismissed a *different* row's open swipe on pointerdown above —
    // that's the click's entire effect, it doesn't also act on the row actually tapped.
    if (press.current.dismissedSwipe) {
      press.current.dismissedSwipe = false;
      return;
    }
    // A tap on the SAME row that's swiped open just closes it (pointerdown only clears
    // swipedId when tapping a *different* row, so this only reaches here in that case).
    if (swipedId) {
      setSwipedId(null);
      return;
    }
    if (selectionMode) toggleSelected(shift.id);
    else setEditingShift(shift);
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

  const allJobsSelected = activeJobs.length > 0 && selectedJobIds.size === activeJobs.length;

  return (
    <div className="screen">
      <div className="history-filter-toggle">
        <button className="link" onClick={() => setShowFilters(!showFilters)}>
          {showFilters ? "Hide Filters" : "Filters"}
        </button>
        <span className="hint">
          {range.label} · {allJobsSelected ? "All jobs" : `${selectedJobIds.size} job${selectedJobIds.size === 1 ? "" : "s"}`}
        </span>
      </div>
      {showFilters && (
        <>
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
              <button className="link" onClick={() => setSelectedJobIds(new Set(activeJobs.map((j) => j.id)))}>
                Select All
              </button>
              <span className="link-separator">·</span>
              <button className="link" onClick={() => setSelectedJobIds(new Set())}>
                Deselect All
              </button>
            </div>
          </div>
          <div className="job-select-list">
            {activeJobs.map((job) => (
              <label key={job.id} className="job-select-row">
                <input type="checkbox" checked={selectedJobIds.has(job.id)} onChange={() => toggleJob(job.id)} />
                <span className="dot" style={{ backgroundColor: job.colorHex }} />
                <span className="job-select-name">{job.name}</span>
              </label>
            ))}
            {activeJobs.length === 0 && (
              <p className="hint">
                {store.jobs.length > 0 ? "No active jobs — archived jobs aren't shown here." : "Add a job in the Jobs tab first."}
              </p>
            )}
          </div>
        </>
      )}

      {!selectionMode && shifts.length > 0 && totalCents > 0 && (
        <div className="total-bar">
          <span className="total-label">Total earned ({range.label})</span>
          <span className="total-value">{formatCents(totalCents)}</span>
        </div>
      )}
      {selectionMode && (
        <div className="selection-bar">
          <button className="link-button" onClick={() => setSelectedIds(new Set())}>
            Cancel
          </button>
          <span className="selection-count">{selectedIds.size} selected</span>
          <button className="link-button" onClick={() => setSelectedIds(new Set(shifts.map((s) => s.id)))}>
            Select All
          </button>
          <button className="link-button danger" onClick={confirmDeleteSelected} aria-label="Delete selected">
            <IoTrashOutline />
          </button>
        </div>
      )}

      {shifts.length === 0 && <p className="muted">No shifts match the current filter.</p>}

      {sections.map((section) => (
        <div key={section.day}>
          <h4 className="section-header">{section.title}</h4>
          {section.shifts.map((shift) => {
            const job = jobsById[shift.jobId];
            const shiftBreaks = store.breaks.filter((b) => b.shiftId === shift.id);
            const worked = roundedWorkedMillis(shift, shiftBreaks, job);
            const pay = payByShiftId.get(shift.id);
            const selected = selectedIds.has(shift.id);
            const isDraggingThis = dragState?.id === shift.id;
            const offset = isDraggingThis ? dragState.dx : swipedId === shift.id ? -SWIPE_ACTION_WIDTH : 0;
            return (
              <div key={shift.id} className="swipe-row">
                <button
                  className="swipe-action-reveal"
                  aria-label="Delete shift"
                  onClick={() => {
                    setSwipedId(null);
                    confirmDelete(shift);
                  }}
                >
                  <IoTrashOutline />
                </button>
                <div
                  className={`row clickable no-callout${selected ? " selected" : ""}`}
                  style={{ transform: `translateX(${offset}px)`, transition: isDraggingThis ? "none" : "transform 0.2s" }}
                  onPointerDown={(e) => onRowPointerDown(e, shift.id)}
                  onPointerMove={(e) => onRowPointerMove(e, shift.id)}
                  onPointerUp={() => onRowPointerUp(shift.id)}
                  onPointerLeave={() => onRowPointerLeaveOrCancel(shift.id)}
                  onPointerCancel={() => onRowPointerLeaveOrCancel(shift.id)}
                  onClick={() => onRowClick(shift)}
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
                    className="link-button muted row-delete-icon"
                    aria-label="Delete shift"
                    onClick={(e) => {
                      e.stopPropagation();
                      confirmDelete(shift);
                    }}
                  >
                    <IoTrashOutline />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {editingShift && <ShiftEditor shift={editingShift} onClose={() => setEditingShift(null)} />}
    </div>
  );
}
