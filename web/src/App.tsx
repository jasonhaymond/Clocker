import { useState } from "react";
import { clearToken, getToken, login, register, setToken } from "./api";
import { StoreProvider, useStore } from "./store";
import { ClockScreen } from "./screens/ClockScreen";
import { JobsScreen } from "./screens/JobsScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { TimesheetsScreen } from "./screens/TimesheetsScreen";
import { ExportScreen } from "./screens/ExportScreen";
import { SettingsScreen } from "./screens/SettingsScreen";

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

type Tab = "clock" | "jobs" | "history" | "timesheets" | "export" | "settings";
const TABS: { key: Tab; label: string }[] = [
  { key: "clock", label: "Clock" },
  { key: "jobs", label: "Jobs" },
  { key: "history", label: "History" },
  { key: "timesheets", label: "Timesheets" },
  { key: "export", label: "Export" },
  { key: "settings", label: "Settings" },
];

// Every store action's failure sets store.error (see store.tsx's `guarded` wrapper) —
// this is the one place that's actually shown, visible above whichever tab is active, so
// a failed action never just "does nothing" with the only trace in the browser console.
function ErrorBanner() {
  const { error, refresh, clearError } = useStore();
  if (!error) return null;
  return (
    <div className="error-banner">
      <span>{error}</span>
      <button className="link-button" onClick={() => refresh()}>
        Retry
      </button>
      <button className="link-button muted" onClick={clearError}>
        ✕
      </button>
    </div>
  );
}

function Dashboard({ onSignOut }: { onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>("clock");

  return (
    <StoreProvider>
      <div className="app-shell">
        <header className="app-header">
          <h1>Clocker</h1>
        </header>
        <nav className="tab-bar">
          {TABS.map((t) => (
            <button key={t.key} className={`tab${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </nav>
        <ErrorBanner />
        <main className="app-main">
          {tab === "clock" && <ClockScreen />}
          {tab === "jobs" && <JobsScreen />}
          {tab === "history" && <HistoryScreen />}
          {tab === "timesheets" && <TimesheetsScreen />}
          {tab === "export" && <ExportScreen />}
          {tab === "settings" && <SettingsScreen onSignOut={onSignOut} />}
        </main>
      </div>
    </StoreProvider>
  );
}

export function App() {
  const [signedIn, setSignedIn] = useState(() => getToken() !== null);

  if (!signedIn) {
    return <AuthForm onSignedIn={() => setSignedIn(true)} />;
  }
  return (
    <Dashboard
      onSignOut={() => {
        clearToken();
        setSignedIn(false);
      }}
    />
  );
}
