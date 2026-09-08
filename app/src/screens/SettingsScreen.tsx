import * as Application from "expo-application";
import Constants from "expo-constants";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { getSyncCursor } from "../db/database";
import { useDbRefresh } from "../lib/useDbRefresh";
import { synchronize } from "../sync/sync";
import { applyUpdate, checkForUpdate, currentRuntimeInfo, otaUpdatesSupported } from "../updates/updates";
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

  const load = useCallback(() => {
    getSyncCursor().then(setLastSynced);
  }, []);
  useDbRefresh(load);

  useEffect(() => updateState.subscribe(setUpdate), []);

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
          otaUpdatesSupported && (
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
          )
        )}
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
  container: { flex: 1, padding: 20, backgroundColor: "#fff" },
  card: { backgroundColor: "#f4f5f7", borderRadius: 12, padding: 20, marginBottom: 24 },
  label: { color: "#666" },
  value: { fontSize: 18, fontWeight: "600", marginTop: 4, marginBottom: 8 },
  updateStatus: { color: "#666", marginBottom: 16 },
  error: { color: "#dc2626", marginBottom: 12 },
  syncButton: { backgroundColor: "#2563eb", borderRadius: 10, padding: 14, alignItems: "center" },
  syncButtonText: { color: "#fff", fontWeight: "600" },
  updateButton: { backgroundColor: "#16a34a", borderRadius: 10, padding: 14, alignItems: "center" },
  checkButton: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#2563eb" },
  checkButtonText: { color: "#2563eb", fontWeight: "600" },
  signOutButton: { padding: 14, alignItems: "center" },
  signOutText: { color: "#dc2626", fontWeight: "600" },
});
