import * as Application from "expo-application";
import Constants from "expo-constants";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../auth/AuthContext";
import { isAppLockAvailable, isAppLockEnabled, setAppLockEnabled } from "../lib/appLock";
import { getSyncCursor } from "../db/database";
import { useDbRefresh } from "../lib/useDbRefresh";
import { getServerUpdateStatus, triggerServerUpdate, type UpdateStatus } from "../sync/api";
import { synchronize } from "../sync/sync";
import { useTheme, type ThemeColors, type ThemeMode } from "../theme/ThemeContext";
import { applyUpdate, checkForUpdate, currentRuntimeInfo } from "../updates/updates";
import { updateState, type UpdateState } from "../updates/updateState";
import { BackupsScreen } from "./BackupsScreen";
import { ChangePasswordScreen } from "./ChangePasswordScreen";
import { ImportScreen } from "./ImportScreen";
import { RecentlyDeletedScreen } from "./RecentlyDeletedScreen";

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

export function SettingsScreen({ onClose }: { onClose: () => void }) {
  const { signOut, logoutEverywhere } = useAuth();
  const { mode, setMode, colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateState>(updateState.get());
  const [serverUpdate, setServerUpdate] = useState<UpdateStatus | null>(null);
  const [serverUpdateError, setServerUpdateError] = useState<string | null>(null);
  const [triggeringServerUpdate, setTriggeringServerUpdate] = useState(false);
  const [showServerLog, setShowServerLog] = useState(false);
  const [showPreviousServerLog, setShowPreviousServerLog] = useState(false);
  const [showBackups, setShowBackups] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showRecentlyDeleted, setShowRecentlyDeleted] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [loggingOutEverywhere, setLoggingOutEverywhere] = useState(false);
  const [logoutEverywhereError, setLogoutEverywhereError] = useState<string | null>(null);
  const [appLockAvailable, setAppLockAvailable] = useState(false);
  const [appLockEnabled, setAppLockEnabledState] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    getSyncCursor().then(setLastSynced);
  }, []);
  useDbRefresh(load);

  useEffect(() => {
    isAppLockAvailable().then(setAppLockAvailable);
    isAppLockEnabled().then(setAppLockEnabledState);
  }, []);

  async function toggleAppLock(value: boolean) {
    setAppLockEnabledState(value);
    await setAppLockEnabled(value);
  }

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

  async function doLogoutEverywhere() {
    setLoggingOutEverywhere(true);
    setLogoutEverywhereError(null);
    try {
      await logoutEverywhere();
    } catch (e: any) {
      setLogoutEverywhereError(e?.message ?? "Something went wrong");
      setLoggingOutEverywhere(false);
    }
    // No `finally` for the busy flag on success — logoutEverywhere() signs this device
    // out too, so RootNavigator unmounts this screen before there's anywhere left to
    // reset the state on.
  }

  function confirmLogoutEverywhere() {
    Alert.alert(
      "Log out everywhere",
      "This signs out every device and browser currently signed into your account, including this one. You'll need to sign in again here too.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Log Out Everywhere", style: "destructive", onPress: doLogoutEverywhere },
      ],
    );
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
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ScrollView style={styles.container} contentContainerStyle={[styles.contentContainer, { paddingTop: insets.top + 14 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.doneText}>Done</Text>
          </TouchableOpacity>
        </View>

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
          {serverUpdate?.previousLog ? (
            <>
              <TouchableOpacity onPress={() => setShowPreviousServerLog(!showPreviousServerLog)}>
                <Text style={styles.logToggle}>{showPreviousServerLog ? "Hide previous log" : "Show previous log"}</Text>
              </TouchableOpacity>
              {showPreviousServerLog && <Text style={styles.logText}>{serverUpdate.previousLog}</Text>}
            </>
          ) : null}
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

        <View style={styles.card}>
          <TouchableOpacity style={styles.syncButton} onPress={() => setShowRecentlyDeleted(true)}>
            <Text style={styles.syncButtonText}>Recently Deleted</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Account</Text>
          <TouchableOpacity style={[styles.syncButton, styles.accountButton]} onPress={() => setShowChangePassword(true)}>
            <Text style={styles.syncButtonText}>Change Password</Text>
          </TouchableOpacity>
          {logoutEverywhereError && <Text style={styles.error}>{logoutEverywhereError}</Text>}
          <TouchableOpacity
            style={[styles.syncButton, styles.accountButton, styles.dangerButton]}
            onPress={confirmLogoutEverywhere}
            disabled={loggingOutEverywhere}
          >
            {loggingOutEverywhere ? <ActivityIndicator color="#fff" /> : <Text style={styles.syncButtonText}>Log Out Everywhere</Text>}
          </TouchableOpacity>
        </View>

        {appLockAvailable && (
          <View style={styles.card}>
            <View style={styles.lockRow}>
              <Text style={styles.syncButtonText}>Require fingerprint to open</Text>
              <Switch value={appLockEnabled} onValueChange={toggleAppLock} />
            </View>
          </View>
        )}

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
        {showImport && <ImportScreen onClose={() => setShowImport(false)} />}
        {showRecentlyDeleted && <RecentlyDeletedScreen onClose={() => setShowRecentlyDeleted(false)} />}
        {showChangePassword && <ChangePasswordScreen onClose={() => setShowChangePassword(false)} />}
      </ScrollView>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.card },
    contentContainer: { padding: 14 },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
    title: { fontSize: 17, fontWeight: "700", color: colors.text },
    doneText: { color: colors.primary, fontWeight: "600", fontSize: 15 },
    card: { backgroundColor: colors.surface, borderRadius: 10, padding: 14, marginBottom: 14 },
    lockRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    label: { color: colors.textMuted3, fontSize: 13 },
    value: { fontSize: 16, fontWeight: "600", marginTop: 3, marginBottom: 6, color: colors.text },
    updateStatus: { color: colors.textMuted3, marginBottom: 10, fontSize: 13 },
    error: { color: colors.danger, marginBottom: 8, fontSize: 13 },
    chipRow: { flexDirection: "row", gap: 8, marginTop: 8 },
    themeChip: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: colors.card },
    themeChipSelected: { backgroundColor: colors.primaryFill, borderColor: colors.primaryFill },
    themeChipText: { fontWeight: "600", fontSize: 13, color: colors.text },
    themeChipTextSelected: { color: colors.onPrimary },
    syncButton: { backgroundColor: colors.primaryFill, borderRadius: 10, padding: 11, alignItems: "center" },
    syncButtonText: { color: colors.onPrimary, fontWeight: "600", fontSize: 14 },
    updateButton: { backgroundColor: colors.successFill, borderRadius: 10, padding: 11, alignItems: "center" },
    checkButton: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary },
    checkButtonText: { color: colors.primary, fontWeight: "600", fontSize: 14 },
    accountButton: { marginBottom: 8 },
    dangerButton: { backgroundColor: colors.danger, marginBottom: 0 },
    signOutButton: { padding: 11, alignItems: "center" },
    signOutText: { color: colors.danger, fontWeight: "600", fontSize: 14 },
    logToggle: { color: colors.primary, fontSize: 13, marginTop: 10, textAlign: "center" },
    logText: { fontFamily: "monospace", fontSize: 10, color: colors.textSecondary, marginTop: 8, backgroundColor: colors.card, padding: 8, borderRadius: 6 },
  });
}
