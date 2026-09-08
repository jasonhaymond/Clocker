export type UpdateStatus = "idle" | "checking" | "up-to-date" | "downloading" | "ready" | "error" | "unsupported";

export interface UpdateState {
  status: UpdateStatus;
  error: string | null;
  checkedAt: string | null;
}

type Listener = (state: UpdateState) => void;

// Same pub/sub shape as src/lib/events.ts, but carrying the current OTA update state so
// both the auto-check on launch and the Settings screen's manual button/banner stay in sync.
class UpdateStateStore {
  private state: UpdateState = { status: "idle", error: null, checkedAt: null };
  private listeners = new Set<Listener>();

  get(): UpdateState {
    return this.state;
  }

  set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const updateState = new UpdateStateStore();
