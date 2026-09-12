import * as Application from "expo-application";
import Constants from "expo-constants";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { getSyncCursor } from "../db/database";
import { useDbRefresh } from "../lib/useDbRefresh";
import { getServerUpdateStatus, triggerServerUpdate, type UpdateStatus } from "../sync/api";
import { synchronize } from "../sync/sync";
import { useTheme, type ThemeColors, type ThemeMode } from "../theme/ThemeContext";
import { applyUpdate, checkForUpdate, currentRuntimeInfo } from "../updates/updates";
import { updateState, type UpdateState } from "../updates/updateState";
import { BackupsScreen } from "./BackupsScreen";
import { HelpScreen } from "./HelpScreen";
import { ImportScreen } from "./ImportScreen";

const appVersion = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "dev";

const THEME_OPTIONS: { key: ThemeMode; label: string }[] = [
  { key: "system", label: "System" },
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
];

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
  const { mode, setMode, colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateState>(updateState.get());
  const [serverUpdate, setServerUpdate] = useState<UpdateStatus | null>(null);
  const [serverUpdateError, setServerUpdateError] = useState<string | null>(null);
  const [triggeringServerUpdate, setTriggeringServerUpdate] = useState(false);
  const [showServerLog, setShowServerLog] = useState(false);
  const [showBackups, setShowBackups] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    getSyncCursor().then(setLastSynced);
  }, []);
  useDbRefresh(load);

  useEffect(() => updateState.subscribe(setUpdate), []);

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
      // Silently ignored: most likely the host agent just isn't deployed yet
      // (see docs/deployment.md#the-host-agent) — not worth alarming a
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
        <Text style={styles.label}>Appearance</Text>
        <View style={styles.chipRow}>
          {THEME_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.key}
              style={[styles.themeChip, mode === opt.key && styles.themeChipSelected]}
              onPress={() => setMode(opt.key)}
            >
              <Text style={[styles.themeChipText, mode === opt.key && styles.themeChipTextSelected]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

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
              <ActivityIndicator color={colors.primary} />
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
        <TouchableOpacity style={styles.syncButton} onPress={() => setShowHelp(true)}>
          <Text style={styles.syncButtonText}>Help</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <TouchableOpacity style={styles.syncButton} onPress={() => setShowBackups(true)}>
          <Text style={styles.syncButtonText}>Backups</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <TouchableOpacity style={styles.syncButton} onPress={() => setShowImport(true)}>
          <Text style={styles.syncButtonText}>Import Data</Text>
        </TouchableOpacity>
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

      {showBackups && <BackupsScreen onClose={() => setShowBackups(false)} />}
      {showHelp && <HelpScreen onClose={() => setShowHelp(false)} />}
      {showImport && <ImportScreen onClose={() => setShowImport(false)} />}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, padding: 14, backgroundColor: colors.card },
    card: { backgroundColor: colors.surface, borderRadius: 10, padding: 14, marginBottom: 14 },
    label: { color: colors.textMuted3, fontSize: 13 },
    value: { fontSize: 16, fontWeight: "600", marginTop: 3, marginBottom: 6, color: colors.text },
    updateStatus: { color: colors.textMuted3, marginBottom: 10, fontSize: 13 },
    error: { color: colors.danger, marginBottom: 8, fontSize: 13 },
    chipRow: { flexDirection: "row", gap: 8, marginTop: 8 },
    themeChip: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: colors.card },
    themeChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
    themeChipText: { fontWeight: "600", fontSize: 13, color: colors.text },
    themeChipTextSelected: { color: colors.onPrimary },
    syncButton: { backgroundColor: colors.primary, borderRadius: 10, padding: 11, alignItems: "center" },
    syncButtonText: { color: colors.onPrimary, fontWeight: "600", fontSize: 14 },
    updateButton: { backgroundColor: colors.success, borderRadius: 10, padding: 11, alignItems: "center" },
    checkButton: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary },
    checkButtonText: { color: colors.primary, fontWeight: "600", fontSize: 14 },
    signOutButton: { padding: 11, alignItems: "center" },
    signOutText: { color: colors.danger, fontWeight: "600", fontSize: 14 },
    logToggle: { color: colors.primary, fontSize: 13, marginTop: 10, textAlign: "center" },
    logText: { fontFamily: "monospace", fontSize: 10, color: colors.textSecondary, marginTop: 8, backgroundColor: colors.card, padding: 8, borderRadius: 6 },
  });
}
