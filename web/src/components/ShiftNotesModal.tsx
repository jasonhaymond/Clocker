import { useState } from "react";
import type { Shift } from "@clocker/shared";
import { useStore } from "../store";

export function ShiftNotesModal({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  const { updateShiftNotes } = useStore();
  const [notes, setNotes] = useState(shift.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await updateShiftNotes(shift, notes.trim() ? notes.trim() : null);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <h3>Note</h3>
        <textarea
          placeholder="Add a note about this shift..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          autoFocus
        />
        <div className="modal-actions">
          <button onClick={onClose}>Skip</button>
          <button className="primary" onClick={save} disabled={saving}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
