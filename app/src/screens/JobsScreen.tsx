import React, { useCallback, useMemo, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { createJob, deleteJob, listJobs, listRateTiers, listRateVersionsForTier, setJobArchived } from "../db/database";
import { useDbRefresh } from "../lib/useDbRefresh";
import type { Job } from "@clocker/shared";
import { useTheme, type ThemeColors } from "../theme/ThemeContext";
import { JobDetailModal } from "./JobDetailModal";

const PALETTE = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2"];

function JobRatePreview({ jobId }: { jobId: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [label, setLabel] = useState<string | null>(null);

  const load = useCallback(() => {
    listRateTiers(jobId, false).then(async (tiers) => {
      const defaultTier = tiers.find((t) => t.isDefault) ?? tiers[0];
      if (!defaultTier) return setLabel(null);
      const versions = await listRateVersionsForTier(defaultTier.id);
      const now = Date.now();
      const active = versions
        .filter((v) => new Date(v.effectiveFrom).getTime() <= now)
        .sort((a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime())[0];
      setLabel(active ? `$${(active.hourlyRateCents / 100).toFixed(2)}/hr` : null);
    });
  }, [jobId]);
  useDbRefresh(load);

  if (!label) return null;
  return <Text style={styles.jobRate}>{label}</Text>;
}

export function JobsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [editingJob, setEditingJob] = useState<Job | null>(null);

  const load = useCallback(() => {
    listJobs(true).then(setJobs);
  }, []);
  useDbRefresh(load);

  async function addJob() {
    if (!name.trim()) return;
    const initialHourlyRateCents = rate.trim() ? Math.round(parseFloat(rate) * 100) : null;
    await createJob({ name: name.trim(), colorHex: color, initialHourlyRateCents });
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
          <TouchableOpacity style={styles.jobRow} onPress={() => setEditingJob(item)}>
            <View style={[styles.dot, { backgroundColor: item.colorHex }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.jobName, item.archived && styles.archivedText]}>{item.name}</Text>
              <JobRatePreview jobId={item.id} />
            </View>
            <TouchableOpacity onPress={() => setJobArchived(item.id, !item.archived)} style={styles.rowAction}>
              <Text style={styles.rowActionText}>{item.archived ? "Unarchive" : "Archive"}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => confirmDelete(item)} style={styles.rowAction}>
              <Text style={[styles.rowActionText, styles.deleteText]}>Delete</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No jobs yet. Add your first one above.</Text>}
      />

      {editingJob && <JobDetailModal job={editingJob} onClose={() => setEditingJob(null)} />}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.card },
    listContent: { padding: 12 },
    form: { marginBottom: 12, padding: 12, backgroundColor: colors.surface, borderRadius: 10 },
    formTitle: { fontWeight: "600", fontSize: 14, marginBottom: 8, color: colors.text },
    input: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 8, padding: 8, marginBottom: 8, backgroundColor: colors.card, color: colors.text },
    swatches: { flexDirection: "row", gap: 8, marginBottom: 8 },
    swatch: { width: 24, height: 24, borderRadius: 12 },
    swatchSelected: { borderWidth: 3, borderColor: colors.text },
    addButton: { backgroundColor: colors.primary, borderRadius: 8, padding: 10, alignItems: "center" },
    addButtonText: { color: colors.onPrimary, fontWeight: "600", fontSize: 14 },
    jobRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 8 },
    dot: { width: 12, height: 12, borderRadius: 6 },
    jobName: { fontSize: 15, fontWeight: "500", color: colors.text },
    jobRate: { color: colors.textMuted3, fontSize: 12 },
    archivedText: { color: colors.textMuted2, textDecorationLine: "line-through" },
    rowAction: { paddingHorizontal: 6, paddingVertical: 3 },
    rowActionText: { color: colors.primary, fontSize: 12 },
    deleteText: { color: colors.danger },
    empty: { textAlign: "center", color: colors.textMuted2, marginTop: 24 },
  });
}
