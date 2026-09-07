import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { getSyncCursor } from "../db/database";
import { useDbRefresh } from "../lib/useDbRefresh";
import { synchronize } from "../sync/sync";

export function SettingsScreen() {
  const { signOut } = useAuth();
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getSyncCursor().then(setLastSynced);
  }, []);
  useDbRefresh(load);

  async function syncNow() {
    setSyncing(true);
    setError(null);
    try {
      await synchronize();
      load();
    } catch (e: any) {
      setError(e?.message ?? "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.label}>Last synced</Text>
        <Text style={styles.value}>{lastSynced ? new Date(lastSynced).toLocaleString() : "Never"}</Text>
        {error && <Text style={styles.error}>{error}</Text>}
        <TouchableOpacity style={styles.syncButton} onPress={syncNow} disabled={syncing}>
          {syncing ? <ActivityIndicator color="#fff" /> : <Text style={styles.syncButtonText}>Sync Now</Text>}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: "#fff" },
  card: { backgroundColor: "#f4f5f7", borderRadius: 12, padding: 20, marginBottom: 24 },
  label: { color: "#666" },
  value: { fontSize: 18, fontWeight: "600", marginTop: 4, marginBottom: 16 },
  error: { color: "#dc2626", marginBottom: 12 },
  syncButton: { backgroundColor: "#2563eb", borderRadius: 10, padding: 14, alignItems: "center" },
  syncButtonText: { color: "#fff", fontWeight: "600" },
  signOutButton: { padding: 14, alignItems: "center" },
  signOutText: { color: "#dc2626", fontWeight: "600" },
});
