import type { Break, Job, JobManager, Manager, RateTier, RateVersion, Shift } from "@clocker/shared";

// This client deliberately has no local database and no outbox (contrast with
// app/src/sync/sync.ts) — see docs/architecture.md's "Two frontend clients, one API".
// Every mutation pushes immediately; every read re-pulls everything. That's a fine trade
// for a browser tab that can reasonably assume it has a network, and it means this file
// is the *entire* client-side sync story, not a small piece of one.

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
const TOKEN_KEY = "clocker.token";

// "Remember me" checked -> localStorage (survives closing the tab/browser). Unchecked ->
// sessionStorage (gone once the tab closes), paired server-side with a short-lived token
// (see server/src/lib/auth.ts) so declining to be remembered actually means something.
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string, rememberMe: boolean): void {
  if (rememberMe) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    sessionStorage.setItem(TOKEN_KEY, token);
  }
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.auth) {
    const token = getToken();
    if (!token) throw new ApiError(401, "Not signed in");
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ? JSON.stringify(data.error) : `Request failed (${res.status})`);
  }
  return data as T;
}

export function getCaptcha() {
  return request<{ id: string; question: string }>("/auth/captcha");
}

export interface Credentials {
  email: string;
  password: string;
  captchaId: string;
  captchaAnswer: number;
  rememberMe: boolean;
}

export function register(credentials: Credentials) {
  return request<{ token: string; userId: string }>("/auth/register", { method: "POST", body: credentials });
}

export function login(credentials: Credentials) {
  return request<{ token: string; userId: string }>("/auth/login", { method: "POST", body: credentials });
}

export interface PushPayload {
  jobs: Job[];
  rateTiers: RateTier[];
  rateVersions: RateVersion[];
  shifts: Shift[];
  breaks: Break[];
  managers: Manager[];
  jobManagers: JobManager[];
  deletedJobIds: string[];
  deletedRateTierIds: string[];
  deletedRateVersionIds: string[];
  deletedShiftIds: string[];
  deletedBreakIds: string[];
  deletedManagerIds: string[];
  deletedJobManagerIds: string[];
}

const EMPTY_PUSH_PAYLOAD: PushPayload = {
  jobs: [],
  rateTiers: [],
  rateVersions: [],
  shifts: [],
  breaks: [],
  managers: [],
  jobManagers: [],
  deletedJobIds: [],
  deletedRateTierIds: [],
  deletedRateVersionIds: [],
  deletedShiftIds: [],
  deletedBreakIds: [],
  deletedManagerIds: [],
  deletedJobManagerIds: [],
};

// Sends only whatever changed — every field optional, defaulting to "nothing of this
// kind changed" — so a caller creating one job just passes `{ jobs: [job] }`.
export function pushChanges(partial: Partial<PushPayload>) {
  const payload: PushPayload = { ...EMPTY_PUSH_PAYLOAD, ...partial };
  return request<{ serverTimestamp: string }>("/sync/push", { method: "POST", body: payload, auth: true });
}

export interface PullResponse {
  serverTimestamp: string;
  jobs: Job[];
  rateTiers: RateTier[];
  rateVersions: RateVersion[];
  shifts: Shift[];
  breaks: Break[];
  managers: Manager[];
  jobManagers: JobManager[];
}

// No cursor: this client has nothing durable to reconcile a partial pull against, so it
// always asks for everything and replaces its in-memory state wholesale. Fine at a single
// user's data volume (see docs/sync-protocol.md's "What sync deliberately does not do").
export function pullAll() {
  return request<PullResponse>("/sync/pull", { auth: true });
}

export interface UpdateStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  log: string;
}

// Hits the host-side host agent (scripts/host-agent.mjs), routed through
// the same domain/token as everything else — see docs/deployment.md#the-host-agent.
export function triggerServerUpdate() {
  return request<{ started: true }>("/update", { method: "POST", auth: true });
}

export function getServerUpdateStatus() {
  return request<UpdateStatus>("/update/status", { auth: true });
}

export interface BackupSchedule {
  frequency: "daily" | "weekly" | "monthly";
  hour: number;
  minute: number;
  weekday: number | null;
  dayOfMonth: number | null;
}

export interface BackupConfig {
  repoUrl: string | null;
  passphraseSet: boolean;
  retentionCount: number | null;
  schedule: BackupSchedule | null;
  sshPublicKey: string | null;
}

export interface BackupConfigUpdate {
  repoUrl?: string;
  passphrase?: string; // "" clears it
  retentionCount?: number | null;
  schedule?: Omit<BackupSchedule, "weekday" | "dayOfMonth"> & { weekday?: number; dayOfMonth?: number } | null;
}

export interface BackupOpStatus {
  running: boolean;
  kind: "backup" | "restore" | null;
  archiveName: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  log: string;
}

export interface BackupRun {
  kind: "backup" | "restore";
  status: "success" | "error";
  archiveName: string | null;
  message: string;
  startedAt: string;
  finishedAt: string;
}

export interface BackupArchive {
  name: string;
  time: string;
}

export function getBackupConfig() {
  return request<BackupConfig>("/backup/config", { auth: true });
}

export function updateBackupConfig(patch: BackupConfigUpdate) {
  return request<BackupConfig>("/backup/config", { method: "PATCH", body: patch, auth: true });
}

export function triggerBackup() {
  return request<{ started: true }>("/backup/run", { method: "POST", auth: true });
}

export function getBackupStatus() {
  return request<BackupOpStatus>("/backup/status", { auth: true });
}

export function getBackupRuns() {
  return request<{ runs: BackupRun[] }>("/backup/runs", { auth: true });
}

export function getBackupArchives() {
  return request<{ archives: BackupArchive[] }>("/backup/archives", { auth: true });
}

export function restoreBackup(archiveName: string, restoreDb: boolean, restoreEnv: boolean) {
  return request<{ started: true }>("/backup/restore", { method: "POST", body: { archiveName, restoreDb, restoreEnv }, auth: true });
}
