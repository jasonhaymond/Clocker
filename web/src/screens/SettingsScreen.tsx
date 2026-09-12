import { useCallback, useEffect, useRef, useState } from "react";
import { getServerUpdateStatus, triggerServerUpdate, type UpdateStatus } from "../api";
import { useStore } from "../store";
import { BackupsScreen } from "./BackupsScreen";
import { HelpScreen } from "./HelpScreen";

export function SettingsScreen({ onSignOut }: { onSignOut: () => void }) {
  const store = useStore();
  const [showBackups, setShowBackups] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [serverUpdate, setServerUpdate] = useState<UpdateStatus | null>(null);
  const [serverUpdateError, setServerUpdateError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollStatus = useCallback(() => {
    getServerUpdateStatus()
      .then((status) => {
        setServerUpdate(status);
        if (!status.running) stopPolling();
      })
      // Expected mid-deploy: the server container restarts, so a poll or two failing is
      // normal, not a real error worth surfacing — keep polling instead.
      .catch(() => {});
  }, [stopPolling]);

  useEffect(() => {
    getServerUpdateStatus()
      .then((status) => {
        setServerUpdate(status);
        if (status.running) pollRef.current = setInterval(pollStatus, 3000);
      })
      // Silently ignored: most likely the host agent just isn't deployed yet
      // (see docs/deployment.md#the-host-agent).
      .catch(() => {});
    return stopPolling;
  }, [pollStatus, stopPolling]);

  async function updateServer() {
    if (!confirm("Pull the latest code and redeploy the server and web client?")) return;
    setTriggering(true);
    setServerUpdateError(null);
    try {
      await triggerServerUpdate();
      stopPolling();
      pollRef.current = setInterval(pollStatus, 3000);
      pollStatus();
    } catch (err) {
      setServerUpdateError(err instanceof Error ? err.message : "Couldn't start the update");
    } finally {
      setTriggering(false);
    }
  }

  if (showBackups) {
    return <BackupsScreen onClose={() => setShowBackups(false)} />;
  }
  if (showHelp) {
    return <HelpScreen onClose={() => setShowHelp(false)} />;
  }

  return (
    <div className="screen">
      <section>
        <div className="row-title">Last synced</div>
        <div className="hint">{store.lastSyncedAt ? new Date(store.lastSyncedAt).toLocaleString() : "Never"}</div>
        <button className="secondary-button" onClick={() => store.refresh()} disabled={store.loading}>
          {store.loading ? "Refreshing…" : "Refresh"}
        </button>
      </section>

      <section>
        <div className="row-title">Server</div>
        {serverUpdate?.running ? (
          <div className="hint">Updating server… this can take a minute or two.</div>
        ) : serverUpdate?.finishedAt ? (
          <div className="hint">
            {serverUpdate.exitCode === 0 ? "Last update succeeded" : `Last update failed (exit ${serverUpdate.exitCode})`}
            {" · "}
            {new Date(serverUpdate.finishedAt).toLocaleString()}
          </div>
        ) : null}
        {serverUpdateError && <p className="error">{serverUpdateError}</p>}
        <button className="secondary-button" onClick={updateServer} disabled={triggering || !!serverUpdate?.running}>
          {triggering || serverUpdate?.running ? "Updating…" : "Update Server"}
        </button>
        {serverUpdate?.log && (
          <>
            <button className="link" onClick={() => setShowLog(!showLog)}>
              {showLog ? "Hide log" : "Show log"}
            </button>
            {showLog && <pre className="update-log">{serverUpdate.log}</pre>}
          </>
        )}
      </section>

      <section>
        <button className="secondary-button" onClick={() => setShowHelp(true)}>
          Help
        </button>
      </section>

      <section>
        <button className="secondary-button" onClick={() => setShowBackups(true)}>
          Backups
        </button>
      </section>

      <section>
        <button className="danger-button" onClick={onSignOut}>
          Sign Out
        </button>
      </section>
    </div>
  );
}
