import React, { useCallback, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { createJob, deleteJob, listJobs, setJobArchived } from "../db/database";
import { useDbRefresh } from "../lib/useDbRefresh";
import type { Job } from "../types";

const PALETTE = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2"];

export function JobsScreen() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [color, setColor] = useState(PALETTE[0]);

  const load = useCallback(() => {
    listJobs(true).then(setJobs);
  }, []);
  useDbRefresh(load);

  async function addJob() {
    if (!name.trim()) return;
    const hourlyRateCents = rate.trim() ? Math.round(parseFloat(rate) * 100) : null;
    await createJob({ name: name.trim(), colorHex: color, hourlyRateCents });
    setName("");
    setRate("");
  }

  function confirmDelete(job: Job) {
    Alert.alert("Delete job", `Delete "${job.name}"? Its recorded shifts stay in your history.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteJob(job.id) },
    ]);
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={jobs}
        keyExtractor={(j) => j.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.form}>
            <Text style={styles.formTitle}>Add a job</Text>
            <TextInput style={styles.input} placeholder="Job name" value={name} onChangeText={setName} />
            <TextInput
              style={styles.input}
              placeholder="Hourly rate (optional)"
              keyboardType="decimal-pad"
              value={rate}
              onChangeText={setRate}
            />
            <View style={styles.swatches}>
              {PALETTE.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.swatch, { backgroundColor: c }, c === color && styles.swatchSelected]}
                  onPress={() => setColor(c)}
                />
              ))}
            </View>
            <TouchableOpacity style={styles.addButton} onPress={addJob}>
              <Text style={styles.addButtonText}>Add Job</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.jobRow}>
            <View style={[styles.dot, { backgroundColor: item.colorHex }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.jobName, item.archived && styles.archivedText]}>{item.name}</Text>
              {item.hourlyRateCents != null && (
                <Text style={styles.jobRate}>${(item.hourlyRateCents / 100).toFixed(2)}/hr</Text>
              )}
            </View>
            <TouchableOpacity onPress={() => setJobArchived(item.id, !item.archived)} style={styles.rowAction}>
              <Text style={styles.rowActionText}>{item.archived ? "Unarchive" : "Archive"}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => confirmDelete(item)} style={styles.rowAction}>
              <Text style={[styles.rowActionText, styles.deleteText]}>Delete</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No jobs yet. Add your first one above.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  listContent: { padding: 16 },
  form: { marginBottom: 16, padding: 16, backgroundColor: "#f4f5f7", borderRadius: 12 },
  formTitle: { fontWeight: "600", fontSize: 16, marginBottom: 12 },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 10, marginBottom: 10, backgroundColor: "#fff" },
  swatches: { flexDirection: "row", gap: 10, marginBottom: 12 },
  swatch: { width: 28, height: 28, borderRadius: 14 },
  swatchSelected: { borderWidth: 3, borderColor: "#111" },
  addButton: { backgroundColor: "#2563eb", borderRadius: 8, padding: 12, alignItems: "center" },
  addButtonText: { color: "#fff", fontWeight: "600" },
  jobRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#eee", gap: 8 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  jobName: { fontSize: 16, fontWeight: "500" },
  jobRate: { color: "#666", fontSize: 13 },
  archivedText: { color: "#999", textDecorationLine: "line-through" },
  rowAction: { paddingHorizontal: 8, paddingVertical: 4 },
  rowActionText: { color: "#2563eb", fontSize: 13 },
  deleteText: { color: "#dc2626" },
  empty: { textAlign: "center", color: "#999", marginTop: 24 },
});
