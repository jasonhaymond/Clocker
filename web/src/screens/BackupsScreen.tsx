import { useCallback, useEffect, useRef, useState } from "react";
import {
  getBackupArchives,
  getBackupConfig,
  getBackupRuns,
  getBackupStatus,
  restoreBackup,
  triggerBackup,
  updateBackupConfig,
  type BackupArchive,
  type BackupConfig,
  type BackupOpStatus,
  type BackupRun,
} from "../api";

const FREQUENCIES = ["off", "daily", "weekly", "monthly"] as const;
type Frequency = (typeof FREQUENCIES)[number];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ArchiveRestoreRow({ archive, onRestored }: { archive: BackupArchive; onRestored: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [restoreDb, setRestoreDb] = useState(true);
  const [restoreEnv, setRestoreEnv] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doRestore() {
    setBusy(true);
    setError(null);
    try {
      await restoreBackup(archive.name, restoreDb, restoreEnv);
      setExpanded(false);
      setConfirmText("");
      onRestored();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the restore");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="archive-row">
      <div className="archive-row-header">
        <div>
          <div className="row-title">{archive.name}</div>
          <div className="hint">{new Date(archive.time).toLocaleString()}</div>
        </div>
        <button className="link" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Cancel" : "Restore..."}
        </button>
      </div>
      {expanded && (
        <div className="restore-panel">
          <label className="checkbox-row">
            <input type="checkbox" checked={restoreDb} onChange={(e) => setRestoreDb(e.target.checked)} />
            Restore database
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={restoreEnv} onChange={(e) => setRestoreEnv(e.target.checked)} />
            Restore secrets (.env.prod) — every signed-in device will need to sign in again if this changes JWT_SECRET
          </label>
          <p className="hint">
            This overwrites live data. Type the archive name (<code>{archive.name}</code>) to confirm.
          </p>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type the archive name"
          />
          {error && <p className="error">{error}</p>}
          <button
            className="secondary-button danger-button"
            onClick={doRestore}
            disabled={busy || confirmText !== archive.name || (!restoreDb && !restoreEnv)}
          >
            {busy ? "Starting…" : "Restore"}
          </button>
        </div>
      )}
    </div>
  );
}

// The SSH key is generated once on the host (`ssh-keygen`, not in any container) and is
// near-instant when it works — but if it fails (most commonly: OpenSSH's client tools
// aren't installed on the host), the server has nothing to return and previously the UI
// just showed "Generating..." forever with no error and no way to retry short of manually
// re-opening this screen. Every GET/PATCH /backup/config now retries generation
// server-side, so a few quick automatic re-fetches cover the normal near-instant case,
// and a real error (surfaced via sshPublicKeyError) plus a manual Retry button covers a
// genuinely broken host instead of spinning silently forever.
const KEY_POLL_ATTEMPTS = 5;
const KEY_POLL_INTERVAL_MS = 1500;

export function BackupsScreen({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<BackupConfig | null>(null);
  const [keyPollAttempt, setKeyPollAttempt] = useState(0);
  const [repoUrl, setRepoUrl] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [retentionCount, setRetentionCount] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("off");
  const [hour, setHour] = useState(3);
  const [minute, setMinute] = useState(0);
  const [weekday, setWeekday] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [opStatus, setOpStatus] = useState<BackupOpStatus | null>(null);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [archives, setArchives] = useState<BackupArchive[]>([]);
  const [runs, setRuns] = useState<BackupRun[]>([]);

  const loadConfig = useCallback(() => {
    getBackupConfig()
      .then((cfg) => {
        if (!cfg) return;
        setConfig(cfg);
        setRepoUrl(cfg.repoUrl ?? "");
        setRetentionCount(cfg.retentionCount != null ? String(cfg.retentionCount) : "");
        if (cfg.schedule) {
          setFrequency(cfg.schedule.frequency);
          setHour(cfg.schedule.hour);
          setMinute(cfg.schedule.minute);
          if (cfg.schedule.weekday != null) setWeekday(cfg.schedule.weekday);
          if (cfg.schedule.dayOfMonth != null) setDayOfMonth(cfg.schedule.dayOfMonth);
        } else {
          setFrequency("off");
        }
      })
      // A malformed/empty response leaves `config` null — the retry effect below no
      // longer requires `config` to already be set to keep trying, so this doesn't need
      // to do anything beyond not crashing; swallowed so it doesn't spam the console on
      // every retry attempt against a server stuck in that state.
      .catch(() => {});
  }, []);

  // Auto-retry a few times while we don't yet have either a key or an error, then stop
  // and let the manual-retry UI below take over rather than polling forever. Previously
  // this required `config` to already be non-null before it would even start — meaning
  // if /backup/config itself never resolved to a real object (the same "empty response"
  // failure mode fixed for /backup/archives above), the retry loop never began at all:
  // keyPollAttempt stayed 0 forever, and the UI was stuck on "Generating..." permanently
  // with no fallback and no way to recover short of reloading the page. This is exactly
  // the bug behind a real report of the key staying stuck even after a redeploy.
  useEffect(() => {
    const haveResolution = !!config?.sshPublicKey || !!config?.sshPublicKeyError;
    if (!haveResolution && keyPollAttempt < KEY_POLL_ATTEMPTS) {
      const timer = setTimeout(() => {
        setKeyPollAttempt((n) => n + 1);
        loadConfig();
      }, KEY_POLL_INTERVAL_MS);
      return () => clearTimeout(timer);
    }
  }, [config, keyPollAttempt, loadConfig]);

  function retryKeyGeneration() {
    setKeyPollAttempt(0);
    loadConfig();
  }

  const loadArchives = useCallback(() => {
    // Same treatment as loadRuns below: a malformed/empty response (seen in practice
    // against a stale or misbehaving deployment) previously crashed here with a raw
    // "Cannot read properties of undefined" — now it's just an empty list, same as
    // genuinely having no archives yet. Not worth a dedicated error state; there's
    // nothing actionable to tell the user beyond what the SSH key / server sections
    // above already surface if the host agent itself is unreachable.
    getBackupArchives()
      .then((r) => setArchives(r?.archives ?? []))
      .catch(() => {});
  }, []);

  const loadRuns = useCallback(() => {
    getBackupRuns()
      .then((r) => setRuns(r?.runs ?? []))
      .catch(() => {});
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollStatus = useCallback(() => {
    getBackupStatus()
      .then((status) => {
        setOpStatus(status);
        if (!status.running) {
          stopPolling();
          loadArchives();
          loadRuns();
        }
      })
      .catch(() => {});
  }, [stopPolling, loadArchives, loadRuns]);

  useEffect(() => {
    loadConfig();
    loadArchives();
    loadRuns();
    getBackupStatus()
      .then((status) => {
        setOpStatus(status);
        if (status.running) pollRef.current = setInterval(pollStatus, 3000);
      })
      .catch(() => {});
    return stopPolling;
  }, [loadConfig, loadArchives, loadRuns, pollStatus, stopPolling]);

  async function saveConfig() {
    setSaving(true);
    setSaveError(null);
    setSavedMessage(null);
    try {
      await updateBackupConfig({
        repoUrl,
        ...(passphrase ? { passphrase } : {}),
        retentionCount: retentionCount.trim() ? Number(retentionCount) : null,
        schedule: frequency === "off" ? null : { frequency, hour, minute, weekday, dayOfMonth },
      });
      setPassphrase("");
      setSavedMessage("Saved.");
      loadConfig();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save backup settings");
    } finally {
      setSaving(false);
    }
  }

  async function clearPassphrase() {
    if (!confirm("Clear the saved passphrase? Backups will stop working until a new one is set.")) return;
    await updateBackupConfig({ passphrase: "" });
    loadConfig();
  }

  async function backUpNow() {
    setTriggering(true);
    setTriggerError(null);
    try {
      await triggerBackup();
      stopPolling();
      pollRef.current = setInterval(pollStatus, 3000);
      pollStatus();
    } catch (err) {
      setTriggerError(err instanceof Error ? err.message : "Couldn't start the backup");
    } finally {
      setTriggering(false);
    }
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="link" onClick={onClose}>
          ← Back to Settings
        </button>
      </div>

      <section>
        <div className="row-title">How to set this up</div>
        <ol className="setup-steps">
          <li>
            If backing up to a remote server over SSH, copy the key below into that
            server's <code>~/.ssh/authorized_keys</code> (a local folder path needs no key
            at all — skip to step 2).
          </li>
          <li>Enter the repository location and a passphrase below, then Save Settings.</li>
          <li>Set a schedule so backups happen on their own, or just use Back Up Now whenever you want one.</li>
          <li>Once you have at least one archive, do a test restore below so you know it actually works before you ever need it for real.</li>
        </ol>
      </section>

      <section>
        <div className="row-title">Backup destination (SSH)</div>
        <div className="hint">
          For a remote repository, grant this key access on the backup server — see docs/deployment.md#the-host-agent.
        </div>
        {config?.sshPublicKey ? (
          <pre className="update-log">{config.sshPublicKey}</pre>
        ) : config?.sshPublicKeyError ? (
          <>
            <p className="error">Couldn't generate a backup key: {config.sshPublicKeyError}</p>
            <button className="link" onClick={retryKeyGeneration}>
              Retry
            </button>
          </>
        ) : keyPollAttempt >= KEY_POLL_ATTEMPTS ? (
          // No sshPublicKeyError doesn't necessarily mean nothing's wrong — an older
          // deployed host agent (predating that field), or /backup/config itself never
          // resolving to a real object at all, would both leave this branch permanently
          // unreachable via config alone, which is exactly what previously left this
          // stuck on "Generating..." forever with no way out (see the retry effect's
          // comment above). Deliberately does NOT require `config` to be set — once the
          // auto-retry budget is spent with still no key, always offer a manual retry.
          <>
            <p className="error">Still generating a backup key after several tries — the host agent may be running an older
              version. Try Update Server (Settings) if this persists, then Retry here.</p>
            <button className="link" onClick={retryKeyGeneration}>
              Retry
            </button>
          </>
        ) : (
          <pre className="update-log">Generating…</pre>
        )}
      </section>

      <section>
        <div className="row-title">Repository &amp; schedule</div>
        <label>Repo URL (local path or user@host:path)</label>
        <input type="text" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="/mnt/backups/clocker" />
        <label>Passphrase {config?.passphraseSet ? "(configured — leave blank to keep)" : "(not set)"}</label>
        <div className="captcha-row">
          <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="Leave blank to keep current" />
          {config?.passphraseSet && (
            <button className="link" onClick={clearPassphrase}>
              Clear
            </button>
          )}
        </div>
        <label>Keep last N archives (blank = never auto-prune)</label>
        <input type="number" min={1} value={retentionCount} onChange={(e) => setRetentionCount(e.target.value)} placeholder="14" />

        <label>Schedule</label>
        <select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
          {FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {f === "off" ? "Off" : f[0].toUpperCase() + f.slice(1)}
            </option>
          ))}
        </select>
        {frequency !== "off" && (
          <div className="captcha-row">
            <select value={hour} onChange={(e) => setHour(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {pad2(h)}
                </option>
              ))}
            </select>
            :
            <select value={minute} onChange={(e) => setMinute(Number(e.target.value))}>
              {[0, 15, 30, 45].map((m) => (
                <option key={m} value={m}>
                  {pad2(m)}
                </option>
              ))}
            </select>
            {frequency === "weekly" && (
              <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            )}
            {frequency === "monthly" && (
              <select value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {saveError && <p className="error">{saveError}</p>}
        {savedMessage && <p className="hint">{savedMessage}</p>}
        <button className="secondary-button" onClick={saveConfig} disabled={saving || !repoUrl.trim()}>
          {saving ? "Saving…" : "Save Settings"}
        </button>
      </section>

      <section>
        <div className="row-title">Back up now</div>
        {opStatus?.running ? (
          <div className="hint">{opStatus.kind === "restore" ? "Restoring…" : "Backing up…"} this can take a while.</div>
        ) : opStatus?.finishedAt ? (
          <div className="hint">
            Last {opStatus.kind}: {opStatus.exitCode === 0 ? "succeeded" : `failed (exit ${opStatus.exitCode})`}
            {" · "}
            {new Date(opStatus.finishedAt).toLocaleString()}
          </div>
        ) : null}
        {triggerError && <p className="error">{triggerError}</p>}
        <button className="secondary-button" onClick={backUpNow} disabled={triggering || !!opStatus?.running || !config?.repoUrl || !config?.passphraseSet}>
          {triggering || opStatus?.running ? "Working…" : "Back Up Now"}
        </button>
        {opStatus?.log && (
          <>
            <button className="link" onClick={() => setShowLog(!showLog)}>
              {showLog ? "Hide log" : "Show log"}
            </button>
            {showLog && <pre className="update-log">{opStatus.log}</pre>}
          </>
        )}
      </section>

      <section>
        <div className="row-title">Archives</div>
        {archives.length === 0 && <p className="hint">No archives yet.</p>}
        {archives.map((a) => (
          <ArchiveRestoreRow key={a.name} archive={a} onRestored={() => { stopPolling(); pollRef.current = setInterval(pollStatus, 3000); pollStatus(); }} />
        ))}
      </section>

      <section>
        <div className="row-title">Recent runs</div>
        {runs.length === 0 && <p className="hint">No runs yet.</p>}
        {runs.map((r, i) => (
          <div key={i} className="run-row">
            <span className={`run-status run-status-${r.status}`}>{r.status}</span>
            <span>{r.kind}</span>
            <span className="hint">{new Date(r.finishedAt).toLocaleString()}</span>
            <span className="hint">{r.message}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
