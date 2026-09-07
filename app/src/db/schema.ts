// Local SQLite mirror of the server's Job/Shift/Break tables, plus two sync bookkeeping
// tables: `pending_changes` (an outbox of rows touched locally since the last successful
// push) and `sync_state` (a single row storing the pull cursor).
export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  color_hex TEXT NOT NULL,
  hourly_rate_cents INTEGER,
  archived INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  clock_in TEXT NOT NULL,
  clock_out TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS breaks (
  id TEXT PRIMARY KEY NOT NULL,
  shift_id TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS pending_changes (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  op TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shifts_job_id ON shifts (job_id);
CREATE INDEX IF NOT EXISTS idx_shifts_clock_in ON shifts (clock_in);
CREATE INDEX IF NOT EXISTS idx_breaks_shift_id ON breaks (shift_id);
`;
