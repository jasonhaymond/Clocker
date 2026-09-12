import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  IoBriefcase,
  IoBriefcaseOutline,
  IoDocumentText,
  IoDocumentTextOutline,
  IoHelpCircleOutline,
  IoList,
  IoListOutline,
  IoMenuOutline,
  IoSettingsOutline,
  IoShare,
  IoShareOutline,
  IoTime,
  IoTimeOutline,
} from "react-icons/io5";
import { clearToken, getCaptcha, getToken, login, register, setToken } from "./api";
import { StoreProvider, useStore } from "./store";
import { ClockScreen } from "./screens/ClockScreen";
import { JobsScreen } from "./screens/JobsScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { TimesheetsScreen } from "./screens/TimesheetsScreen";
import { ExportScreen } from "./screens/ExportScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { HelpScreen } from "./screens/HelpScreen";

function AuthForm({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [captcha, setCaptcha] = useState<{ id: string; question: string } | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function refreshCaptcha() {
    setCaptchaAnswer("");
    getCaptcha()
      .then(setCaptcha)
      .catch(() => setCaptcha(null));
  }

  useEffect(refreshCaptcha, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!captcha) return;
    setBusy(true);
    setError(null);
    try {
      const credentials = { email, password, captchaId: captcha.id, captchaAnswer: Number(captchaAnswer), rememberMe };
      const result = mode === "login" ? await login(credentials) : await register(credentials);
      setToken(result.token, rememberMe);
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      refreshCaptcha();
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
        {captcha && (
          <div className="captcha-row">
            <span>{captcha.question}</span>
            <input
              type="number"
              placeholder="Answer"
              value={captchaAnswer}
              onChange={(e) => setCaptchaAnswer(e.target.value)}
              required
            />
          </div>
        )}
        <div className="switch-row">
          <div className="row-title">Remember me</div>
          <label className="switch">
            <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
            <span className="switch-track" />
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy || !captcha || !captchaAnswer}>
          {mode === "login" ? "Sign In" : "Create Account"}
        </button>
      </form>
      <button className="link" onClick={() => setMode(mode === "login" ? "register" : "login")}>
        {mode === "login" ? "Need an account? Register" : "Have an account? Sign in"}
      </button>
    </div>
  );
}

// Settings and Help live behind the header's hamburger menu, not the bottom bar — see
// HeaderMenu below — so only the 5 tabs a user switches between constantly get a bottom
// icon slot, same as app/'s bottom tab navigator would if it had this many destinations
// competing for space on a narrow screen.
type Tab = "clock" | "jobs" | "history" | "timesheets" | "export";
type Overlay = "settings" | "help" | null;

// Same icon set (Ionicons) as app/src/navigation/RootNavigator.tsx's bottom tab bar, via
// react-icons/io5 — this bar is deliberately styled to mimic that one as closely as a web
// page reasonably can, right down to which icon goes with which tab.
const TABS: { key: Tab; label: string; icon: ComponentType; iconActive: ComponentType }[] = [
  { key: "clock", label: "Clock", icon: IoTimeOutline, iconActive: IoTime },
  { key: "jobs", label: "Jobs", icon: IoBriefcaseOutline, iconActive: IoBriefcase },
  { key: "history", label: "History", icon: IoListOutline, iconActive: IoList },
  { key: "timesheets", label: "Timesheets", icon: IoDocumentTextOutline, iconActive: IoDocumentText },
  { key: "export", label: "Export", icon: IoShareOutline, iconActive: IoShare },
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

// Hamburger menu, top right of the header: the entry point for Settings and Help, which
// don't get their own bottom-bar slot (see the Tab/Overlay split above). Closes on an
// outside click/tap as well as on selecting an item, the way any dropdown menu should.
function HeaderMenu({ overlay, onSelect }: { overlay: Overlay; onSelect: (o: Overlay) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div className="header-menu" ref={ref}>
      <button className="header-menu-button" onClick={() => setOpen(!open)} aria-label="Menu">
        <IoMenuOutline />
      </button>
      {open && (
        <div className="header-menu-dropdown">
          <button
            className={`header-menu-item${overlay === "settings" ? " active" : ""}`}
            onClick={() => {
              onSelect("settings");
              setOpen(false);
            }}
          >
            <IoSettingsOutline />
            <span>Settings</span>
          </button>
          <button
            className={`header-menu-item${overlay === "help" ? " active" : ""}`}
            onClick={() => {
              onSelect("help");
              setOpen(false);
            }}
          >
            <IoHelpCircleOutline />
            <span>Help</span>
          </button>
        </div>
      )}
    </div>
  );
}

function Dashboard({ onSignOut }: { onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>("clock");
  const [overlay, setOverlay] = useState<Overlay>(null);

  function selectTab(t: Tab) {
    setOverlay(null);
    setTab(t);
  }

  return (
    <StoreProvider>
      <div className="app-shell">
        {/* Always the app name/brand, not the current screen — which tab you're on is
            shown by the active icon in the bottom bar instead. Branded (see --header-bg/
            --header-text in index.css) — a constant identity element that doesn't change
            with the light/dark content theme. */}
        <header className="app-header">
          <h1>Clocker</h1>
          <HeaderMenu overlay={overlay} onSelect={setOverlay} />
        </header>
        <ErrorBanner />
        <main className="app-main">
          {overlay === "settings" ? (
            <SettingsScreen onSignOut={onSignOut} />
          ) : overlay === "help" ? (
            <HelpScreen onClose={() => setOverlay(null)} />
          ) : (
            <>
              {tab === "clock" && <ClockScreen />}
              {tab === "jobs" && <JobsScreen />}
              {tab === "history" && <HistoryScreen />}
              {tab === "timesheets" && <TimesheetsScreen />}
              {tab === "export" && <ExportScreen />}
            </>
          )}
        </main>
        <nav className="tab-bar">
          {TABS.map((t) => {
            const isActive = !overlay && tab === t.key;
            const Icon = isActive ? t.iconActive : t.icon;
            return (
              <button key={t.key} className={`tab${isActive ? " active" : ""}`} onClick={() => selectTab(t.key)}>
                <Icon />
                <span>{t.label}</span>
              </button>
            );
          })}
        </nav>
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
