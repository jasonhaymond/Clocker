import * as Application from "expo-application";
import Constants from "expo-constants";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { getSyncCursor } from "../db/database";
import { getPromptForNotesOnClockOut, setPromptForNotesOnClockOut } from "../lib/preferences";
import { useDbRefresh } from "../lib/useDbRefresh";
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

  const load = useCallback(() => {
    getSyncCursor().then(setLastSynced);
  }, []);
  useDbRefresh(load);

  useEffect(() => updateState.subscribe(setUpdate), []);
  useEffect(() => {
    getPromptForNotesOnClockOut().then(setPromptForNotes);
  }, []);

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
});
