import type { Break, Job, JobManager, Manager, RateTier, RateVersion, Shift } from "@clocker/shared";

// This client deliberately has no local database and no outbox (contrast with
// app/src/sync/sync.ts) — see docs/architecture.md's "Two frontend clients, one API".
// Every mutation pushes immediately; every read re-pulls everything. That's a fine trade
// for a browser tab that can reasonably assume it has a network, and it means this file
// is the *entire* client-side sync story, not a small piece of one.

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
const TOKEN_KEY = "clocker.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
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

export function register(email: string, password: string) {
  return request<{ token: string; userId: string }>("/auth/register", { method: "POST", body: { email, password } });
}

export function login(email: string, password: string) {
  return request<{ token: string; userId: string }>("/auth/login", { method: "POST", body: { email, password } });
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
