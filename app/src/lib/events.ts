type Listener = () => void;

// Minimal pub/sub so screens can refetch from SQLite after a mutation or a sync run,
// without pulling in a full reactive-query library for a single-user local app.
class DbEvents {
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const dbEvents = new DbEvents();
