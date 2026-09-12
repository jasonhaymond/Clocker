import type { Break, Job, JobManager, Manager, RateTier, RateVersion, Shift } from "@clocker/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { pullAll, pushChanges } from "./api";

// The web client's entire "database": whatever the last pull returned, held in memory.
// Every mutation below pushes the one change immediately, then calls refresh() to pull
// the authoritative result back — there's no local write-ahead state to keep in sync,
// unlike app/'s SQLite mirror + outbox. See docs/architecture.md's "Two frontend
// clients, one API".
interface StoreState {
  jobs: Job[];
  rateTiers: RateTier[];
  rateVersions: RateVersion[];
  shifts: Shift[];
  breaks: Break[];
  managers: Manager[];
  jobManagers: JobManager[];
  loading: boolean;
  error: string | null;
  lastSyncedAt: string | null;
}

const EMPTY_STATE: StoreState = {
  jobs: [],
  rateTiers: [],
  rateVersions: [],
  shifts: [],
  breaks: [],
  managers: [],
  jobManagers: [],
  loading: true,
  error: null,
  lastSyncedAt: null,
};

function newId(): string {
  return crypto.randomUUID();
}
function nowIso(): string {
  return new Date().toISOString();
}

interface StoreActions {
  refresh(): Promise<void>;
  clearError(): void;

  createJob(input: { name: string; colorHex: string; initialHourlyRateCents: number | null }): Promise<Job>;
  updateJobDetails(job: Job, patch: { name?: string; colorHex?: string }): Promise<void>;
  updateJobOvertime(job: Job, patch: { overtimeMultiplier: number | null; overtimeWeeklyThresholdHours: number | null }): Promise<void>;
  updateJobRounding(job: Job, patch: Pick<Job, "roundingEnabled" | "roundingMode" | "roundingIncrementMinutes">): Promise<void>;
  updateJobPromptForNotes(job: Job, promptForNotesOnClockOut: boolean): Promise<void>;
  updateJobExpectedHours(job: Job, patch: Pick<Job, "expectedWeeklyHours" | "expectedHoursWeekStartDay">): Promise<void>;
  updateJobTimesheetSettings(
    job: Job,
    patch: Partial<
      Pick<
        Job,
        | "timesheetPeriodType"
        | "timesheetWeekStartDay"
        | "timesheetBiweeklyAnchor"
        | "timesheetMonthlyStartDay"
        | "timesheetFormat"
        | "timesheetIncludeEarnings"
        | "timesheetIncludeNotes"
        | "timesheetIncludeTimes"
      >
    >,
  ): Promise<void>;
  setJobArchived(job: Job, archived: boolean): Promise<void>;
  deleteJob(job: Job): Promise<void>;

  createRateTier(jobId: string, name: string, initialHourlyRateCents: number | null, isDefault: boolean): Promise<RateTier>;
  setRateTierArchived(tier: RateTier, archived: boolean): Promise<void>;
  deleteRateTier(tier: RateTier): Promise<void>;
  addRateVersion(tierId: string, hourlyRateCents: number, effectiveFrom?: string): Promise<RateVersion>;

  createManager(input: { name: string; email: string }): Promise<Manager>;
  updateManager(manager: Manager, patch: { name?: string; email?: string }): Promise<void>;
  setManagerArchived(manager: Manager, archived: boolean): Promise<void>;
  deleteManager(manager: Manager): Promise<void>;
  addJobManager(jobId: string, managerId: string): Promise<JobManager>;
  removeJobManager(jm: JobManager): Promise<void>;

  clockIn(jobId: string, rateTierId: string | null, clockInTime?: string): Promise<Shift>;
  clockOut(shift: Shift, clockOutTime?: string): Promise<void>;
  updateShiftNotes(shift: Shift, notes: string | null): Promise<void>;
  updateShiftTimes(shift: Shift, patch: { clockIn?: string; clockOut?: string | null }): Promise<void>;
  deleteShift(shift: Shift): Promise<void>;
  deleteShifts(shifts: Shift[]): Promise<void>;
  startBreak(shiftId: string, startTime?: string): Promise<Break>;
  endBreak(brk: Break, endTime?: string): Promise<void>;
  updateBreakTimes(brk: Break, patch: { start?: string; end?: string | null }): Promise<void>;
  deleteBreak(brk: Break): Promise<void>;
}

const StoreContext = createContext<(StoreState & StoreActions) | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StoreState>(EMPTY_STATE);

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const pulled = await pullAll();
      setState({
        jobs: pulled.jobs.filter((j) => !j.deletedAt),
        rateTiers: pulled.rateTiers.filter((t) => !t.deletedAt),
        rateVersions: pulled.rateVersions.filter((v) => !v.deletedAt),
        shifts: pulled.shifts.filter((s) => !s.deletedAt),
        breaks: pulled.breaks.filter((b) => !b.deletedAt),
        managers: pulled.managers.filter((m) => !m.deletedAt),
        jobManagers: pulled.jobManagers.filter((jm) => !jm.deletedAt),
        loading: false,
        error: null,
        lastSyncedAt: nowIso(),
      });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : "Couldn't load data" }));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Every action below can throw (a network error, a 4xx/5xx from the server) — without
  // this, a screen that calls one without its own try/catch (most of them, e.g. "Add
  // Job") sees the failure go nowhere: an unhandled promise rejection in the console,
  // nothing on screen, "the button does nothing." This wraps every action (except
  // refresh, which already manages state.error itself) so a failure always becomes a
  // visible message via the error banner in App.tsx, in addition to still rejecting the
  // promise normally for any caller that does want to handle it locally.
  function guarded<Args extends unknown[], R>(fn: (...args: Args) => Promise<R>): (...args: Args) => Promise<R> {
    return async (...args: Args) => {
      try {
        return await fn(...args);
      } catch (err) {
        setState((s) => ({ ...s, error: err instanceof Error ? err.message : "Something went wrong" }));
        throw err;
      }
    };
  }

  const actions = useMemo<StoreActions>(() => {
    const raw: StoreActions = {
      refresh,
      clearError() {
        setState((s) => ({ ...s, error: null }));
      },

      async createJob({ name, colorHex, initialHourlyRateCents }) {
        const now = nowIso();
        const job: Job = {
          id: newId(),
          name,
          colorHex,
          archived: false,
          overtimeMultiplier: null,
          overtimeWeeklyThresholdHours: null,
          timesheetPeriodType: "weekly",
          timesheetWeekStartDay: 1,
          timesheetBiweeklyAnchor: now,
          timesheetMonthlyStartDay: 1,
          timesheetFormat: "both",
          timesheetIncludeEarnings: true,
          timesheetIncludeNotes: true,
          timesheetIncludeTimes: true,
          roundingEnabled: false,
          roundingMode: "nearest",
          roundingIncrementMinutes: 15,
          promptForNotesOnClockOut: false,
          expectedWeeklyHours: null,
          expectedHoursWeekStartDay: 1,
          updatedAt: now,
          deletedAt: null,
        };
        const tier: RateTier = { id: newId(), jobId: job.id, name: "Standard", isDefault: true, archived: false, updatedAt: now, deletedAt: null };
        const versions: RateVersion[] =
          initialHourlyRateCents != null
            ? [{ id: newId(), tierId: tier.id, hourlyRateCents: initialHourlyRateCents, effectiveFrom: now, updatedAt: now, deletedAt: null }]
            : [];
        await pushChanges({ jobs: [job], rateTiers: [tier], rateVersions: versions });
        await refresh();
        return job;
      },

      async updateJobDetails(job, patch) {
        await pushChanges({ jobs: [{ ...job, ...patch, updatedAt: nowIso() }] });
        await refresh();
      },
      async updateJobOvertime(job, patch) {
        await pushChanges({ jobs: [{ ...job, ...patch, updatedAt: nowIso() }] });
        await refresh();
      },
      async updateJobRounding(job, patch) {
        await pushChanges({ jobs: [{ ...job, ...patch, updatedAt: nowIso() }] });
        await refresh();
      },
      async updateJobPromptForNotes(job, promptForNotesOnClockOut) {
        await pushChanges({ jobs: [{ ...job, promptForNotesOnClockOut, updatedAt: nowIso() }] });
        await refresh();
      },
      async updateJobExpectedHours(job, patch) {
        await pushChanges({ jobs: [{ ...job, ...patch, updatedAt: nowIso() }] });
        await refresh();
      },
      async updateJobTimesheetSettings(job, patch) {
        await pushChanges({ jobs: [{ ...job, ...patch, updatedAt: nowIso() }] });
        await refresh();
      },
      async setJobArchived(job, archived) {
        await pushChanges({ jobs: [{ ...job, archived, updatedAt: nowIso() }] });
        await refresh();
      },
      async deleteJob(job) {
        await pushChanges({ deletedJobIds: [job.id] });
        await refresh();
      },

      async createRateTier(jobId, name, initialHourlyRateCents, isDefault) {
        const now = nowIso();
        const tier: RateTier = { id: newId(), jobId, name, isDefault, archived: false, updatedAt: now, deletedAt: null };
        const versions: RateVersion[] =
          initialHourlyRateCents != null
            ? [{ id: newId(), tierId: tier.id, hourlyRateCents: initialHourlyRateCents, effectiveFrom: now, updatedAt: now, deletedAt: null }]
            : [];
        await pushChanges({ rateTiers: [tier], rateVersions: versions });
        await refresh();
        return tier;
      },
      async setRateTierArchived(tier, archived) {
        await pushChanges({ rateTiers: [{ ...tier, archived, updatedAt: nowIso() }] });
        await refresh();
      },
      async deleteRateTier(tier) {
        await pushChanges({ deletedRateTierIds: [tier.id] });
        await refresh();
      },
      async addRateVersion(tierId, hourlyRateCents, effectiveFrom) {
        const now = nowIso();
        const version: RateVersion = { id: newId(), tierId, hourlyRateCents, effectiveFrom: effectiveFrom ?? now, updatedAt: now, deletedAt: null };
        await pushChanges({ rateVersions: [version] });
        await refresh();
        return version;
      },

      async createManager({ name, email }) {
        const now = nowIso();
        const manager: Manager = { id: newId(), name, email, archived: false, updatedAt: now, deletedAt: null };
        await pushChanges({ managers: [manager] });
        await refresh();
        return manager;
      },
      async updateManager(manager, patch) {
        await pushChanges({ managers: [{ ...manager, ...patch, updatedAt: nowIso() }] });
        await refresh();
      },
      async setManagerArchived(manager, archived) {
        await pushChanges({ managers: [{ ...manager, archived, updatedAt: nowIso() }] });
        await refresh();
      },
      async deleteManager(manager) {
        await pushChanges({ deletedManagerIds: [manager.id] });
        await refresh();
      },
      async addJobManager(jobId, managerId) {
        const now = nowIso();
        const jm: JobManager = { id: newId(), jobId, managerId, updatedAt: now, deletedAt: null };
        await pushChanges({ jobManagers: [jm] });
        await refresh();
        return jm;
      },
      async removeJobManager(jm) {
        await pushChanges({ deletedJobManagerIds: [jm.id] });
        await refresh();
      },

      async clockIn(jobId, rateTierId, clockInTime) {
        const now = nowIso();
        const shift: Shift = {
          id: newId(),
          jobId,
          rateTierId,
          clockIn: clockInTime ?? now,
          clockOut: null,
          notes: null,
          updatedAt: now,
          deletedAt: null,
        };
        await pushChanges({ shifts: [shift] });
        await refresh();
        return shift;
      },
      async clockOut(shift, clockOutTime) {
        await pushChanges({ shifts: [{ ...shift, clockOut: clockOutTime ?? nowIso(), updatedAt: nowIso() }] });
        await refresh();
      },
      async updateShiftNotes(shift, notes) {
        await pushChanges({ shifts: [{ ...shift, notes, updatedAt: nowIso() }] });
        await refresh();
      },
      async updateShiftTimes(shift, patch) {
        await pushChanges({ shifts: [{ ...shift, ...patch, updatedAt: nowIso() }] });
        await refresh();
      },
      async deleteShift(shift) {
        await pushChanges({ deletedShiftIds: [shift.id] });
        await refresh();
      },
      async deleteShifts(shifts) {
        await pushChanges({ deletedShiftIds: shifts.map((s) => s.id) });
        await refresh();
      },
      async startBreak(shiftId, startTime) {
        const now = nowIso();
        const brk: Break = { id: newId(), shiftId, start: startTime ?? now, end: null, updatedAt: now, deletedAt: null };
        await pushChanges({ breaks: [brk] });
        await refresh();
        return brk;
      },
      async endBreak(brk, endTime) {
        await pushChanges({ breaks: [{ ...brk, end: endTime ?? nowIso(), updatedAt: nowIso() }] });
        await refresh();
      },
      async updateBreakTimes(brk, patch) {
        await pushChanges({ breaks: [{ ...brk, ...patch, updatedAt: nowIso() }] });
        await refresh();
      },
      async deleteBreak(brk) {
        await pushChanges({ deletedBreakIds: [brk.id] });
        await refresh();
      },
    };
    const unguarded = new Set(["refresh", "clearError"]);
    const entries = Object.entries(raw).map(([key, fn]) => [
      key,
      unguarded.has(key) ? fn : guarded(fn as (...a: unknown[]) => Promise<unknown>),
    ]);
    return Object.fromEntries(entries) as StoreActions;
  }, [refresh]);

  const value = useMemo(() => ({ ...state, ...actions }), [state, actions]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreState & StoreActions {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within a StoreProvider");
  return ctx;
}
