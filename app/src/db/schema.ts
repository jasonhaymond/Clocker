// Local SQLite mirror of the server's tables, plus two sync bookkeeping tables:
// `pending_changes` (an outbox of rows touched locally since the last successful push)
// and `sync_state` (a single row storing the pull cursor). Schema evolves via numbered
// migrations applied against SQLite's built-in `PRAGMA user_version` (see
// `runMigrations` in `database.ts`) — never edit an already-shipped migration's SQL,
// add a new one instead, the same rule as `server/prisma/migrations`.

// Version 1 — the original baseline.
export const BASELINE_SQL = `
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

// Version 2 — rate tiers, rate history, per-job overtime, and a shift -> tier reference.
// `jobs.hourly_rate_cents` is left in place (unused from here on) rather than dropped:
// SQLite's ALTER TABLE DROP COLUMN support varies by bundled version, and there's nothing
// to gain locally from removing an already-empty-for-new-rows column. New code should
// never read or write it — rate data lives in rate_tiers/rate_versions from now on.
const V2_RATE_TIERS_SQL = `
ALTER TABLE jobs ADD COLUMN overtime_multiplier REAL;
ALTER TABLE jobs ADD COLUMN overtime_weekly_threshold_hours REAL;
ALTER TABLE shifts ADD COLUMN rate_tier_id TEXT;

CREATE TABLE IF NOT EXISTS rate_tiers (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS rate_versions (
  id TEXT PRIMARY KEY NOT NULL,
  tier_id TEXT NOT NULL,
  hourly_rate_cents INTEGER NOT NULL,
  effective_from TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_rate_tiers_job_id ON rate_tiers (job_id);
CREATE INDEX IF NOT EXISTS idx_rate_versions_tier_id ON rate_versions (tier_id);
`;

// Version 3 — saved email recipients for the export flow.
const V3_MANAGERS_SQL = `
CREATE TABLE IF NOT EXISTS managers (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
`;

export const SCHEMA_VERSION = 3;

// Applied in order to bring a database from version N-1 to version N. Index 0 here is
// the migration to version 1 (the baseline, safe to (re)run via CREATE TABLE IF NOT
// EXISTS), index 1 is version 2, and so on.
export const MIGRATIONS: string[] = [BASELINE_SQL, V2_RATE_TIERS_SQL, V3_MANAGERS_SQL];
