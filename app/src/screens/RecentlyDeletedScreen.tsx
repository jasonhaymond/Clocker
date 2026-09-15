import { formatClock, formatDay, type Job, type Shift } from "@clocker/shared";
import React, { useCallback, useMemo, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { listDeletedJobs, listDeletedShifts, listJobs, restoreJob, restoreShift } from "../db/database";
import { useDbRefresh } from "../lib/useDbRefresh";
import { useTheme, type ThemeColors } from "../theme/ThemeContext";

// Jobs and shifts are only ever soft-deleted (see docs/data-model.md) — nothing here is
// ever purged, by design (kept recoverable indefinitely, not on any expiry timer), so
// this screen is just a different view onto rows that were already sitting in the
// database with deleted_at set. Scoped to jobs and shifts specifically — the two delete
// flows with an actual confirm dialog today, and the two where losing something by
// accident is genuinely costly; managers/rate tiers stay out of scope.
export function RecentlyDeletedScreen({ onClose }: { onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const [deletedJobs, setDeletedJobs] = useState<Job[]>([]);
  const [deletedShifts, setDeletedShifts] = useState<Shift[]>([]);
  // Every job (active or deleted) by id, so a deleted shift can still show its job's
  // name/color even if that job is itself deleted too.
  const [jobById, setJobById] = useState<Record<string, Job>>({});

  const load = useCallback(() => {
    Promise.all([listDeletedJobs(), listDeletedShifts(), listJobs(true)]).then(([jobs, shifts, activeJobs]) => {
      setDeletedJobs(jobs);
      setDeletedShifts(shifts);
      const map: Record<string, Job> = {};
      for (const j of [...activeJobs, ...jobs]) map[j.id] = j;
      setJobById(map);
    });
  }, []);
  useDbRefresh(load);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 14, paddingTop: insets.top + 14 }}>
        <View style={styles.header}>
          <Text style={styles.title}>Recently Deleted</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.doneText}>Done</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>
          Deleted jobs and shifts stay here, recoverable, for as long as you keep them —
          nothing is ever purged automatically.
        </Text>

        <Text style={styles.sectionLabel}>Jobs</Text>
        {deletedJobs.length === 0 && <Text style={styles.empty}>No deleted jobs.</Text>}
        {deletedJobs.map((job) => (
          <View key={job.id} style={styles.row}>
            <View style={[styles.dot, { backgroundColor: job.colorHex }]} />
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle}>{job.name}</Text>
              <Text style={styles.rowSubtitle}>Deleted {formatDay(job.deletedAt!)}</Text>
            </View>
            <TouchableOpacity onPress={() => restoreJob(job.id)}>
              <Text style={styles.restoreText}>Restore</Text>
            </TouchableOpacity>
          </View>
        ))}

        <Text style={styles.sectionLabel}>Shifts</Text>
        {deletedShifts.length === 0 && <Text style={styles.empty}>No deleted shifts.</Text>}
        {deletedShifts.map((shift) => {
          const job = jobById[shift.jobId];
          return (
            <View key={shift.id} style={styles.row}>
              <View style={[styles.dot, { backgroundColor: job?.colorHex ?? colors.textMuted }]} />
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle}>
                  {job?.name ?? "Unknown job"}
                  {job?.deletedAt ? " (also deleted)" : ""}
                </Text>
                <Text style={styles.rowSubtitle}>
                  {formatDay(shift.clockIn)} · {formatClock(shift.clockIn)} – {shift.clockOut ? formatClock(shift.clockOut) : "still open"}
                </Text>
              </View>
              <TouchableOpacity onPress={() => restoreShift(shift.id)}>
                <Text style={styles.restoreText}>Restore</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.card },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
    title: { fontSize: 17, fontWeight: "700", color: colors.text },
    doneText: { color: colors.primary, fontWeight: "600", fontSize: 15 },
    hint: { color: colors.textMuted2, fontSize: 12, marginBottom: 4, lineHeight: 17 },
    sectionLabel: { fontWeight: "600", color: colors.textSecondary, marginTop: 16, marginBottom: 6, fontSize: 13 },
    empty: { color: colors.textMuted2, fontSize: 13, paddingVertical: 6 },
    row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
    dot: { width: 12, height: 12, borderRadius: 6 },
    rowMain: { flex: 1 },
    rowTitle: { fontSize: 14, fontWeight: "600", color: colors.text },
    rowSubtitle: { fontSize: 12, color: colors.textMuted3, marginTop: 1 },
    restoreText: { color: colors.primary, fontWeight: "600", fontSize: 13 },
  });
}
