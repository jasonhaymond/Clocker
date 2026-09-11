import * as Application from "expo-application";
import Constants from "expo-constants";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { getSyncCursor } from "../db/database";
import { getPromptForNotesOnClockOut, setPromptForNotesOnClockOut } from "../lib/preferences";
import { useDbRefresh } from "../lib/useDbRefresh";
import { getServerUpdateStatus, triggerServerUpdate, type UpdateStatus } from "../sync/api";
import { synchronize } from "../sync/sync";
import { applyUpdate, checkForUpdate, currentRuntimeInfo } from "../updates/updates";
import { updateState, type UpdateState } from "../updates/updateState";

const appVersion = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "dev";

function updateStatusText(state: UpdateState): string {
  switch (state.status) {
    case "checking":
      return "Checking for updates…";
    case "downloading":
      return "Downloading update…";
    case "ready":
      return "Update downloaded — restart to apply";
    case "up-to-date":
      return "You're on the latest version";
    case "error":
      return state.error ?? "Update check failed";
    case "unsupported":
      return "Updates aren't available in this build (Expo Go or local dev)";
    default:
      return "Not checked yet";
  }
}

export function SettingsScreen() {
  const { signOut } = useAuth();
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateState>(updateState.get());
  const [promptForNotes, setPromptForNotes] = useState(false);
  const [serverUpdate, setServerUpdate] = useState<UpdateStatus | null>(null);
  const [serverUpdateError, setServerUpdateError] = useState<string | null>(null);
  const [triggeringServerUpdate, setTriggeringServerUpdate] = useState(false);
  const [showServerLog, setShowServerLog] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    getSyncCursor().then(setLastSynced);
  }, []);
  useDbRefresh(load);

  useEffect(() => updateState.subscribe(setUpdate), []);
  useEffect(() => {
    getPromptForNotesOnClockOut().then(setPromptForNotes);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollServerUpdateStatus = useCallback(() => {
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
        if (status.running) pollRef.current = setInterval(pollServerUpdateStatus, 3000);
      })
      // Silently ignored: most likely the update-trigger service just isn't deployed yet
      // (see docs/deployment.md#triggering-an-update-from-the-app) — not worth alarming a
      // user who never asked for this on first opening Settings.
      .catch(() => {});
    return stopPolling;
  }, [pollServerUpdateStatus, stopPolling]);

  async function updateServer() {
    setTriggeringServerUpdate(true);
    setServerUpdateError(null);
    try {
      await triggerServerUpdate();
      stopPolling();
      pollRef.current = setInterval(pollServerUpdateStatus, 3000);
      pollServerUpdateStatus();
    } catch (e: any) {
      setServerUpdateError(e?.message ?? "Couldn't start the update");
    } finally {
      setTriggeringServerUpdate(false);
    }
  }

  function confirmUpdateServer() {
    Alert.alert("Update server", "Pull the latest code and redeploy the server and web client?", [
      { text: "Cancel", style: "cancel" },
      { text: "Update", onPress: updateServer },
    ]);
  }

  async function togglePromptForNotes(value: boolean) {
    setPromptForNotes(value);
    await setPromptForNotesOnClockOut(value);
  }

  async function syncNow() {
    setSyncing(true);
    setSyncError(null);
    try {
      await synchronize();
      load();
    } catch (e: any) {
      setSyncError(e?.message ?? "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.label}>Last synced</Text>
        <Text style={styles.value}>{lastSynced ? new Date(lastSynced).toLocaleString() : "Never"}</Text>
        {syncError && <Text style={styles.error}>{syncError}</Text>}
        <TouchableOpacity style={styles.syncButton} onPress={syncNow} disabled={syncing}>
          {syncing ? <ActivityIndicator color="#fff" /> : <Text style={styles.syncButtonText}>Sync Now</Text>}
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>App version</Text>
        <Text style={styles.value}>
          {appVersion}
          {currentRuntimeInfo.channel ? ` · ${currentRuntimeInfo.channel}` : ""}
        </Text>
        <Text style={styles.updateStatus}>{updateStatusText(update)}</Text>

        {update.status === "ready" ? (
          <TouchableOpacity style={styles.updateButton} onPress={applyUpdate}>
            <Text style={styles.syncButtonText}>Restart to Update</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.updateButton, styles.checkButton]}
            onPress={() => checkForUpdate()}
            disabled={update.status === "checking" || update.status === "downloading"}
          >
            {update.status === "checking" || update.status === "downloading" ? (
              <ActivityIndicator color="#2563eb" />
            ) : (
              <Text style={styles.checkButtonText}>Check for Updates</Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Server</Text>
        {serverUpdate?.running ? (
          <Text style={styles.updateStatus}>Updating server… this can take a minute or two.</Text>
        ) : serverUpdate?.finishedAt ? (
          <Text style={styles.updateStatus}>
            {serverUpdate.exitCode === 0 ? "Last update succeeded" : `Last update failed (exit ${serverUpdate.exitCode})`}
            {" · "}
            {new Date(serverUpdate.finishedAt).toLocaleString()}
          </Text>
        ) : null}
        {serverUpdateError && <Text style={styles.error}>{serverUpdateError}</Text>}
        <TouchableOpacity
          style={styles.syncButton}
          onPress={confirmUpdateServer}
          disabled={triggeringServerUpdate || !!serverUpdate?.running}
        >
          {triggeringServerUpdate || serverUpdate?.running ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.syncButtonText}>Update Server</Text>
          )}
        </TouchableOpacity>
        {serverUpdate?.log ? (
          <>
            <TouchableOpacity onPress={() => setShowServerLog(!showServerLog)}>
              <Text style={styles.logToggle}>{showServerLog ? "Hide log" : "Show log"}</Text>
            </TouchableOpacity>
            {showServerLog && <Text style={styles.logText}>{serverUpdate.log}</Text>}
          </>
        ) : null}
      </View>

      <View style={styles.card}>
        <View style={styles.preferenceRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.preferenceLabel}>Prompt for notes when clocking out</Text>
            <Text style={styles.preferenceHint}>Asks for an optional note right after you clock out of a shift.</Text>
          </View>
          <Switch value={promptForNotes} onValueChange={togglePromptForNotes} />
        </View>
      </View>

      <TouchableOpacity
        style={styles.signOutButton}
        onPress={() => Alert.alert("Sign out", "You can sign back in any time; your data stays on the server.", [
          { text: "Cancel", style: "cancel" },
          { text: "Sign Out", style: "destructive", onPress: signOut },
        ])}
      >
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 14, backgroundColor: "#fff" },
  card: { backgroundColor: "#f4f5f7", borderRadius: 10, padding: 14, marginBottom: 14 },
  label: { color: "#666", fontSize: 13 },
  value: { fontSize: 16, fontWeight: "600", marginTop: 3, marginBottom: 6 },
  updateStatus: { color: "#666", marginBottom: 10, fontSize: 13 },
  error: { color: "#dc2626", marginBottom: 8, fontSize: 13 },
  preferenceRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  preferenceLabel: { fontSize: 14, fontWeight: "600" },
  preferenceHint: { color: "#666", fontSize: 12, marginTop: 1 },
  syncButton: { backgroundColor: "#2563eb", borderRadius: 10, padding: 11, alignItems: "center" },
  syncButtonText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  updateButton: { backgroundColor: "#16a34a", borderRadius: 10, padding: 11, alignItems: "center" },
  checkButton: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#2563eb" },
  checkButtonText: { color: "#2563eb", fontWeight: "600", fontSize: 14 },
  signOutButton: { padding: 11, alignItems: "center" },
  signOutText: { color: "#dc2626", fontWeight: "600", fontSize: 14 },
  logToggle: { color: "#2563eb", fontSize: 13, marginTop: 10, textAlign: "center" },
  logText: { fontFamily: "monospace", fontSize: 10, color: "#333", marginTop: 8, backgroundColor: "#fff", padding: 8, borderRadius: 6 },
});
