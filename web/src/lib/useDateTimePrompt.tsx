import { useCallback, useRef, useState } from "react";

// Web equivalent of app/'s useDateTimePicker — the mobile app's imperative native
// pickers don't exist here, but a browser's own `<input type="datetime-local">` already
// gives a native-feeling picker UI, so a small modal wrapping one is enough.
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function useDateTimePrompt() {
  const [state, setState] = useState<{ title: string; value: string } | null>(null);
  const resolveRef = useRef<((date: Date | null) => void) | null>(null);

  const prompt = useCallback((initial: Date, title: string): Promise<Date | null> => {
    setState({ title, value: toLocalInputValue(initial) });
    return new Promise((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  function finish(date: Date | null) {
    resolveRef.current?.(date);
    resolveRef.current = null;
    setState(null);
  }

  const modal = state ? (
    <div className="modal-backdrop">
      <div className="modal-card">
        <h3>{state.title}</h3>
        <input
          type="datetime-local"
          value={state.value}
          onChange={(e) => setState((s) => (s ? { ...s, value: e.target.value } : s))}
          autoFocus
        />
        <div className="modal-actions">
          <button onClick={() => finish(null)}>Cancel</button>
          <button className="primary" onClick={() => finish(state.value ? new Date(state.value) : null)}>
            OK
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { prompt, modal };
}
