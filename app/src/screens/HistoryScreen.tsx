import React, { useCallback, useMemo, useState } from "react";
import { Alert, Modal, SectionList, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import {
  deleteShift,
  listBreaksForShifts,
  listJobs,
  listRateTiersForJobs,
  listRateVersionsForTiers,
  listShiftsInRange,
  updateShiftTimes,
} from "../db/database";
import { addDays, formatClock, formatDay, formatDuration, startOfDay, workedMillis } from "../lib/time";
import { useDbRefresh } from "../lib/useDbRefresh";
import { calculateShiftPay, formatCents, type ShiftPay } from "../lib/pay";
import type { Break, Job, RateTier, RateVersion, Shift } from "../types";

const DAYS_BACK = 90;

function NotesModal({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  const [notes, setNotes] = useState(shift.notes ?? "");

  async function save() {
    await updateShiftTimes(shift.id, { notes: notes.trim() ? notes.trim() : null });
    onClose();
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Note</Text>
          <TextInput
            style={styles.notesInput}
            placeholder="Add a note about this shift..."
            value={notes}
            onChangeText={setNotes}
            multiline
            autoFocus
          />
          <View style={styles.modalActions}>
            <TouchableOpacity onPress={onClose} style={styles.modalButton}>
              <Text style={styles.modalButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={save} style={[styles.modalButton, styles.modalButtonPrimary]}>
              <Text style={[styles.modalButtonText, styles.modalButtonPrimaryText]}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function HistoryScreen() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [breaksByShift, setBreaksByShift] = useState<Record<string, Break[]>>({});
  const [jobsById, setJobsById] = useState<Record<string, Job>>({});
  const [tiers, setTiers] = useState<RateTier[]>([]);
  const [versions, setVersions] = useState<RateVersion[]>([]);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);

  const load = useCallback(() => {
    const start = addDays(startOfDay(new Date()), -DAYS_BACK);
    const end = addDays(startOfDay(new Date()), 1);
    Promise.all([listShiftsInRange(start.toISOString(), end.toISOString()), listJobs(true)]).then(async ([shiftRows, jobRows]) => {
      setShifts(shiftRows);
      setJobsById(Object.fromEntries(jobRows.map((j) => [j.id, j])));
      const [breaks, jobTiers] = await Promise.all([
        listBreaksForShifts(shiftRows.map((s) => s.id)),
        listRateTiersForJobs(jobRows.map((j) => j.id)),
      ]);
      const grouped: Record<string, Break[]> = {};
      for (const b of breaks) (grouped[b.shiftId] ??= []).push(b);
      setBreaksByShift(grouped);
      setTiers(jobTiers);
      setVersions(await listRateVersionsForTiers(jobTiers.map((t) => t.id)));
    });
  }, []);
  useDbRefresh(load);

  const payByShiftId = useMemo(() => {
    const map = new Map<string, ShiftPay>();
    const shiftsByJob = new Map<string, Shift[]>();
    for (const s of shifts) {
      if (!shiftsByJob.has(s.jobId)) shiftsByJob.set(s.jobId, []);
      shiftsByJob.get(s.jobId)!.push(s);
    }
    for (const [jobId, jobShifts] of shiftsByJob) {
      const job = jobsById[jobId];
      if (!job) continue;
      const jobTiers = tiers.filter((t) => t.jobId === jobId);
      const tierIds = new Set(jobTiers.map((t) => t.id));
      const jobVersions = versions.filter((v) => tierIds.has(v.tierId));
      const shiftsWithHours = jobShifts.map((s) => ({
        shift: s,
        workedHours: workedMillis(s, breaksByShift[s.id] ?? []) / 3_600_000,
      }));
      for (const pay of calculateShiftPay({ job, tiers: jobTiers, versions: jobVersions, shiftsWithHours })) {
        map.set(pay.shiftId, pay);
      }
    }
    return map;
  }, [shifts, jobsById, tiers, versions, breaksByShift]);

  const sections = useMemo(() => {
    const byDay = new Map<string, Shift[]>();
    for (const shift of shifts) {
      const key = startOfDay(new Date(shift.clockIn)).toISOString();
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(shift);
    }
    return Array.from(byDay.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, dayShifts]) => {
        const totalMs = dayShifts.reduce((sum, s) => sum + workedMillis(s, breaksByShift[s.id] ?? []), 0);
        return { title: `${formatDay(day)} — ${formatDuration(totalMs)}`, data: dayShifts };
      });
  }, [shifts, breaksByShift]);

  function confirmDelete(shift: Shift) {
    Alert.alert("Delete shift", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteShift(shift.id) },
    ]);
  }

  return (
    <>
      <SectionList
        style={styles.container}
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
        renderItem={({ item }) => {
          const job = jobsById[item.jobId];
          const shiftBreaks = breaksByShift[item.id] ?? [];
          const worked = workedMillis(item, shiftBreaks);
          const pay = payByShiftId.get(item.id);
          return (
            <TouchableOpacity style={styles.row} onPress={() => setEditingShift(item)} onLongPress={() => confirmDelete(item)}>
              <View style={[styles.dot, { backgroundColor: job?.colorHex ?? "#999" }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.jobName}>{job?.name ?? "Deleted job"}</Text>
                <Text style={styles.times}>
                  {formatClock(item.clockIn)} – {item.clockOut ? formatClock(item.clockOut) : "in progress"}
                  {shiftBreaks.length > 0 ? ` · ${shiftBreaks.length} break${shiftBreaks.length > 1 ? "s" : ""}` : ""}
                </Text>
                {item.notes ? (
                  <Text style={styles.notesPreview} numberOfLines={1}>
                    {item.notes}
                  </Text>
                ) : null}
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.duration}>{formatDuration(worked)}</Text>
                {pay && pay.rateCentsPerHour != null && <Text style={styles.pay}>{formatCents(pay.totalCents)}</Text>}
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No shifts in the last {DAYS_BACK} days.</Text>}
      />
      {editingShift && <NotesModal shift={editingShift} onClose={() => setEditingShift(null)} />}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  sectionHeader: { fontWeight: "700", fontSize: 14, color: "#444", backgroundColor: "#fff", paddingVertical: 8 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#eee", gap: 10 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  jobName: { fontSize: 16, fontWeight: "500" },
  times: { color: "#666", fontSize: 13, marginTop: 2 },
  notesPreview: { color: "#999", fontSize: 12, marginTop: 2, fontStyle: "italic" },
  duration: { fontWeight: "600" },
  pay: { color: "#16a34a", fontSize: 13, marginTop: 2 },
  empty: { textAlign: "center", color: "#999", marginTop: 24 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
  modalCard: { backgroundColor: "#fff", borderRadius: 16, padding: 20 },
  modalTitle: { fontSize: 16, fontWeight: "700", marginBottom: 12 },
  notesInput: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 12, minHeight: 100, textAlignVertical: "top" },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 16 },
  modalButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  modalButtonPrimary: { backgroundColor: "#2563eb" },
  modalButtonText: { fontWeight: "600", color: "#333" },
  modalButtonPrimaryText: { color: "#fff" },
});
