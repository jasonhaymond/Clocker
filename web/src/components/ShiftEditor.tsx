import { formatClock, formatDay, type Break, type Shift } from "@clocker/shared";
import { useState } from "react";
import { useDateTimePrompt } from "../lib/useDateTimePrompt";
import { useStore } from "../store";

// Full shift editor: notes, clock-in/out times, and breaks — reachable from History for
// any shift in the last 90 days, open or already clocked out. Setting a clock-out here on
// a still-open shift closes it, the same as clocking out normally; there's deliberately
// no way to *clear* an existing clock-out and reopen a shift (see app/'s ShiftEditor for
// the same reasoning — a job can already have a newer open shift by then).
export function ShiftEditor({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  const store = useStore();
  const [notes, setNotes] = useState(shift.notes ?? "");
  const { prompt, modal } = useDateTimePrompt();

  const breaks = store.breaks.filter((b) => b.shiftId === shift.id);

  async function saveNotes() {
    const trimmed = notes.trim();
    if (trimmed !== (shift.notes ?? "")) await store.updateShiftNotes(shift, trimmed || null);
  }

  async function editClockIn() {
    const date = await prompt(new Date(shift.clockIn), "Clock In");
    if (!date) return;
    if (shift.clockOut && date.getTime() >= new Date(shift.clockOut).getTime()) {
      alert("Clock-in must be before clock-out.");
      return;
    }
    await store.updateShiftTimes(shift, { clockIn: date.toISOString() });
  }

  async function editClockOut() {
    const date = await prompt(shift.clockOut ? new Date(shift.clockOut) : new Date(), shift.clockOut ? "Clock Out" : "Set Clock Out");
    if (!date) return;
    if (date.getTime() <= new Date(shift.clockIn).getTime()) {
      alert("Clock-out must be after clock-in.");
      return;
    }
    await store.updateShiftTimes(shift, { clockOut: date.toISOString() });
  }

  async function addBreak() {
    const brk = await store.startBreak(shift.id, shift.clockIn);
    await store.endBreak(brk, shift.clockIn);
  }

  async function editBreakStart(brk: Break) {
    const date = await prompt(new Date(brk.start), "Break Start");
    if (!date) return;
    if (brk.end && date.getTime() >= new Date(brk.end).getTime()) {
      alert("Break start must be before its end.");
      return;
    }
    await store.updateBreakTimes(brk, { start: date.toISOString() });
  }

  async function editBreakEnd(brk: Break) {
    const date = await prompt(brk.end ? new Date(brk.end) : new Date(), "Break End");
    if (!date) return;
    if (date.getTime() <= new Date(brk.start).getTime()) {
      alert("Break end must be after its start.");
      return;
    }
    await store.updateBreakTimes(brk, { end: date.toISOString() });
  }

  function confirmDeleteBreak(brk: Break) {
    if (window.confirm("Delete this break? This can't be undone.")) store.deleteBreak(brk);
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card modal-card-large">
        <div className="modal-header">
          <h2>Edit Shift</h2>
        </div>
        <div className="modal-scroll">
          <h4>{formatDay(shift.clockIn)}</h4>

          <div className="row">
            <span className="row-title" style={{ flex: 1 }}>
              Clock in
            </span>
            <button className="link-button" onClick={editClockIn}>
              {formatClock(shift.clockIn)}
            </button>
          </div>
          <div className="row">
            <span className="row-title" style={{ flex: 1 }}>
              Clock out
            </span>
            <button className="link-button" onClick={editClockOut}>
              {shift.clockOut ? formatClock(shift.clockOut) : "Still clocked in — set..."}
            </button>
          </div>

          <h4>Breaks</h4>
          {breaks.length === 0 && <p className="hint">No breaks recorded.</p>}
          {breaks.map((brk) => (
            <div key={brk.id} className="row">
              <button className="link-button" onClick={() => editBreakStart(brk)}>
                {formatClock(brk.start)}
              </button>
              <span className="hint">–</span>
              <button className="link-button" onClick={() => editBreakEnd(brk)}>
                {brk.end ? formatClock(brk.end) : "ongoing — set..."}
              </button>
              <button className="link-button muted" style={{ marginLeft: "auto" }} onClick={() => confirmDeleteBreak(brk)}>
                Delete
              </button>
            </div>
          ))}
          <button className="secondary-button" onClick={addBreak}>
            + Add Break
          </button>

          <h4>Note</h4>
          <textarea placeholder="Add a note about this shift..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
        </div>
        {/* Only the note is draft state here — Cancel discards it. Clock in/out and break
            edits above each commit immediately via their own date/time picker, the same
            "commit per interaction" pattern used everywhere else in this app (rate
            tiers, job settings, ...); Cancel can't retroactively undo those. */}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            onClick={() => {
              saveNotes();
              onClose();
            }}
          >
            Done
          </button>
        </div>
      </div>
      {modal}
    </div>
  );
}
