import { useState } from "react";
import { getPromptForNotesOnClockOut, setPromptForNotesOnClockOut } from "../lib/preferences";
import { useStore } from "../store";

export function SettingsScreen({ onSignOut }: { onSignOut: () => void }) {
  const store = useStore();
  const [promptForNotes, setPromptForNotes] = useState(getPromptForNotesOnClockOut());

  return (
    <div className="screen">
      <section>
        <div className="switch-row">
          <div>
            <div className="row-title">Prompt for notes on clock out</div>
            <div className="hint">Shows a quick note field right after clocking out of any job.</div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={promptForNotes}
              onChange={(e) => {
                setPromptForNotes(e.target.checked);
                setPromptForNotesOnClockOut(e.target.checked);
              }}
            />
            <span className="switch-track" />
          </label>
        </div>
      </section>

      <section>
        <button className="secondary-button" onClick={() => store.refresh()} disabled={store.loading}>
          {store.loading ? "Refreshing…" : "Refresh"}
        </button>
      </section>

      <section>
        <button className="danger-button" onClick={onSignOut}>
          Sign Out
        </button>
      </section>
    </div>
  );
}
