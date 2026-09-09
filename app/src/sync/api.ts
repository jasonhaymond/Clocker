import { getToken } from "../auth/tokenStore";
import type { Break, Job, RateTier, RateVersion, Shift } from "../types";

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
  deletedJobIds: string[];
  deletedRateTierIds: string[];
  deletedRateVersionIds: string[];
  deletedShiftIds: string[];
  deletedBreakIds: string[];
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
}

export function pullChanges(since: string | null) {
  const query = since ? `?since=${encodeURIComponent(since)}` : "";
  return request<PullResponse>(`/sync/pull${query}`, { auth: true });
}
