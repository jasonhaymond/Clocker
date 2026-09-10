import { formatDuration, workedMillis, type Break, type Job, type Shift } from "@clocker/shared";
import { useCallback, useEffect, useState } from "react";
import { clearToken, getToken, login, pullAll, pushChanges, register, setToken } from "./api";

const PALETTE = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2"];

function newJob(name: string, colorHex: string): Job {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
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
    updatedAt: now,
    deletedAt: null,
  };
}

function AuthForm({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = mode === "login" ? await login(email, password) : await register(email, password);
      setToken(result.token);
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-card">
      <h1>Clocker</h1>
      <form onSubmit={submit}>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {mode === "login" ? "Sign In" : "Create Account"}
        </button>
      </form>
      <button className="link" onClick={() => setMode(mode === "login" ? "register" : "login")}>
        {mode === "login" ? "Need an account? Register" : "Have an account? Sign in"}
      </button>
    </div>
  );
}

function Dashboard({ onSignOut }: { onSignOut: () => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [breaks, setBreaks] = useState<Break[]>([]);
  const [newJobName, setNewJobName] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pulled = await pullAll();
      setJobs(pulled.jobs.filter((j) => !j.deletedAt));
      setShifts(pulled.shifts.filter((s) => !s.deletedAt));
      setBreaks(pulled.breaks.filter((b) => !b.deletedAt));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function addJob() {
    if (!newJobName.trim()) return;
    await pushChanges({ jobs: [newJob(newJobName.trim(), color)] });
    setNewJobName("");
    await refresh();
  }

  function openShiftFor(jobId: string): Shift | undefined {
    return shifts.find((s) => s.jobId === jobId && !s.clockOut);
  }

  async function clockIn(jobId: string) {
    if (openShiftFor(jobId)) return;
    const now = new Date().toISOString();
    const shift: Shift = {
      id: crypto.randomUUID(),
      jobId,
      rateTierId: null,
      clockIn: now,
      clockOut: null,
      notes: null,
      updatedAt: now,
      deletedAt: null,
    };
    await pushChanges({ shifts: [shift] });
    await refresh();
  }

  async function clockOut(shift: Shift) {
    await pushChanges({ shifts: [{ ...shift, clockOut: new Date().toISOString() }] });
    await refresh();
  }

  return (
    <div className="dashboard">
      <header>
        <h1>Clocker</h1>
        <div>
          <button onClick={refresh} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            onClick={() => {
              clearToken();
              onSignOut();
            }}
          >
            Sign Out
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <section>
        <h2>Add a job</h2>
        <div className="add-job">
          <input placeholder="Job name" value={newJobName} onChange={(e) => setNewJobName(e.target.value)} />
          <div className="swatches">
            {PALETTE.map((c) => (
              <button
                key={c}
                className={`swatch${c === color ? " selected" : ""}`}
                style={{ backgroundColor: c }}
                onClick={() => setColor(c)}
                aria-label={c}
              />
            ))}
          </div>
          <button onClick={addJob}>Add Job</button>
        </div>
      </section>

      <section>
        <h2>Jobs</h2>
        {jobs.length === 0 && <p className="muted">No jobs yet.</p>}
        {jobs.map((job) => {
          const open = openShiftFor(job.id);
          return (
            <div key={job.id} className="job-row">
              <span className="dot" style={{ backgroundColor: job.colorHex }} />
              <span className="job-name">{job.name}</span>
              {open ? (
                <>
                  <span className="live">Clocked in since {new Date(open.clockIn).toLocaleTimeString()}</span>
                  <button onClick={() => clockOut(open)}>Clock Out</button>
                </>
              ) : (
                <button onClick={() => clockIn(job.id)}>Clock In</button>
              )}
            </div>
          );
        })}
      </section>

      <section>
        <h2>Recent shifts</h2>
        {shifts.length === 0 && <p className="muted">No shifts yet.</p>}
        {[...shifts]
          .sort((a, b) => (a.clockIn < b.clockIn ? 1 : -1))
          .slice(0, 20)
          .map((shift) => {
            const job = jobs.find((j) => j.id === shift.jobId);
            const shiftBreaks = breaks.filter((b) => b.shiftId === shift.id);
            return (
              <div key={shift.id} className="shift-row">
                <span className="dot" style={{ backgroundColor: job?.colorHex ?? "#999" }} />
                <span className="job-name">{job?.name ?? "Deleted job"}</span>
                <span className="muted">{new Date(shift.clockIn).toLocaleString()}</span>
                <span>{shift.clockOut ? formatDuration(workedMillis(shift, shiftBreaks)) : "in progress"}</span>
              </div>
            );
          })}
      </section>
    </div>
  );
}

export function App() {
  const [signedIn, setSignedIn] = useState(() => getToken() !== null);

  if (!signedIn) {
    return <AuthForm onSignedIn={() => setSignedIn(true)} />;
  }
  return <Dashboard onSignOut={() => setSignedIn(false)} />;
}
