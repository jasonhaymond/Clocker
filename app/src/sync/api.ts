import { getToken } from "../auth/tokenStore";
import type { Break, Job, JobManager, Manager, RateTier, RateVersion, Shift } from "@clocker/shared";

// Points at your Fastify server. Set EXPO_PUBLIC_API_URL in app/.env (copy from
// app/.env.example) for a persistent override, or inline per-command — Android emulator
// uses http://10.0.2.2:3001, a physical device needs your machine's LAN IP (e.g.
// http://192.168.1.20:3001), a deployed server just uses its URL (see docs/deployment.md).
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, options: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.auth) {
    const token = await getToken();
    if (!token) throw new ApiError(401, "Not signed in");
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  // A response from something other than our own API (a reverse proxy's own error page,
  // a static file server's plain-text/HTML 405) isn't JSON at all — JSON.parse would
  // throw and mask the real HTTP status behind an unrelated "Unexpected token" error.
  // Every caller should see a clean status-based message even then.
  let data: { error?: unknown } | undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    const hint =
      res.status === 405 && (path.startsWith("/update") || path.startsWith("/backup"))
        ? " — your reverse proxy may not be routing this path to the host agent yet (see docs/deployment.md#the-host-agent)"
        : "";
    throw new ApiError(res.status, data?.error ? JSON.stringify(data.error) : `Request failed (${res.status})${hint}`);
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

export function pushChanges(payload: PushPayload) {
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

export function pullChanges(since: string | null) {
  const query = since ? `?since=${encodeURIComponent(since)}` : "";
  return request<PullResponse>(`/sync/pull${query}`, { auth: true });
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
  sshPublicKeyError: string | null;
}

export interface BackupConfigUpdate {
  repoUrl?: string;
  passphrase?: string; // "" clears it
  retentionCount?: number | null;
  schedule?: (Omit<BackupSchedule, "weekday" | "dayOfMonth"> & { weekday?: number; dayOfMonth?: number }) | null;
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

// Disaster recovery: lists/restores against any repo+passphrase typed in on the spot,
// independent of the saved backup config — for recovering onto a fresh install, or one
// whose own saved backup config was itself lost.
export function getDisasterRecoveryArchives(repoUrl: string, passphrase: string) {
  return request<{ archives: BackupArchive[] }>("/backup/disaster-recovery/archives", {
    method: "POST",
    body: { repoUrl, passphrase },
    auth: true,
  });
}

export function restoreFromDisasterRecovery(
  repoUrl: string,
  passphrase: string,
  archiveName: string,
  restoreDb: boolean,
  restoreEnv: boolean,
) {
  return request<{ started: true }>("/backup/disaster-recovery/restore", {
    method: "POST",
    body: { repoUrl, passphrase, archiveName, restoreDb, restoreEnv },
    auth: true,
  });
}
