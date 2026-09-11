import Ionicons from "@expo/vector-icons/Ionicons";
import React, { useCallback, useMemo, useState } from "react";
import { Alert, SectionList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  deleteShift,
  listBreaksForShifts,
  listJobs,
  listRateTiersForJobs,
  listRateVersionsForTiers,
  listShiftsInRange,
} from "../db/database";
import { ShiftEditor } from "../components/ShiftEditor";
import { useDbRefresh } from "../lib/useDbRefresh";
import {
  addDays,
  formatClock,
  formatDay,
  formatDuration,
  startOfDay,
  calculateShiftPay,
  formatCents,
  roundedWorkedMillis,
  type ShiftPay,
  type Break,
  type Job,
  type RateTier,
  type RateVersion,
  type Shift,
} from "@clocker/shared";

const DAYS_BACK = 90;

export function HistoryScreen() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [breaksByShift, setBreaksByShift] = useState<Record<string, Break[]>>({});
  const [jobsById, setJobsById] = useState<Record<string, Job>>({});
  const [tiers, setTiers] = useState<RateTier[]>([]);
  const [versions, setVersions] = useState<RateVersion[]>([]);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectionMode = selectedIds.size > 0;

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
        workedHours: roundedWorkedMillis(s, breaksByShift[s.id] ?? [], job) / 3_600_000,
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
        const totalMs = dayShifts.reduce((sum, s) => sum + roundedWorkedMillis(s, breaksByShift[s.id] ?? [], jobsById[s.jobId]), 0);
        return { title: `${formatDay(day)} — ${formatDuration(totalMs)}`, data: dayShifts };
      });
  }, [shifts, breaksByShift, jobsById]);

  function confirmDelete(shift: Shift) {
    Alert.alert("Delete shift", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteShift(shift.id) },
    ]);
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(shifts.map((s) => s.id)));
  }

  function confirmDeleteSelected() {
    const count = selectedIds.size;
    Alert.alert("Delete shifts", `Delete ${count} shift${count === 1 ? "" : "s"}? This can't be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          for (const id of selectedIds) await deleteShift(id);
          setSelectedIds(new Set());
        },
      },
    ]);
  }

  return (
    <>
      {selectionMode && (
        <View style={styles.selectionBar}>
          <TouchableOpacity onPress={() => setSelectedIds(new Set())} style={styles.selectionAction}>
            <Text style={styles.selectionActionText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.selectionCount}>{selectedIds.size} selected</Text>
          <TouchableOpacity onPress={selectAll} style={styles.selectionAction}>
            <Text style={styles.selectionActionText}>Select All</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={confirmDeleteSelected} style={styles.selectionAction}>
            <Ionicons name="trash-outline" size={18} color="#dc2626" />
          </TouchableOpacity>
        </View>
      )}
      <SectionList
        style={styles.container}
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 12 }}
        renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
        renderItem={({ item }) => {
          const job = jobsById[item.jobId];
          const shiftBreaks = breaksByShift[item.id] ?? [];
          const worked = roundedWorkedMillis(item, shiftBreaks, job);
          const pay = payByShiftId.get(item.id);
          const selected = selectedIds.has(item.id);
          return (
            <TouchableOpacity
              style={[styles.row, selected && styles.rowSelected]}
              onPress={() => (selectionMode ? toggleSelected(item.id) : setEditingShift(item))}
              onLongPress={() => (selectionMode ? confirmDelete(item) : toggleSelected(item.id))}
            >
              {selectionMode && (
                <View style={[styles.checkboxBox, selected && styles.checkboxBoxChecked]}>
                  {selected && <Ionicons name="checkmark" size={13} color="#fff" />}
                </View>
              )}
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
      {editingShift && (
        <ShiftEditor shift={editingShift} onClose={() => setEditingShift(null)} />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  sectionHeader: { fontWeight: "700", fontSize: 13, color: "#444", backgroundColor: "#fff", paddingVertical: 5 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#eee", gap: 8 },
  rowSelected: { backgroundColor: "#eff6ff" },
  checkboxBox: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: "#999", alignItems: "center", justifyContent: "center" },
  checkboxBoxChecked: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  dot: { width: 11, height: 11, borderRadius: 6 },
  jobName: { fontSize: 15, fontWeight: "500" },
  times: { color: "#666", fontSize: 12, marginTop: 1 },
  notesPreview: { color: "#999", fontSize: 11, marginTop: 1, fontStyle: "italic" },
  duration: { fontWeight: "600", fontSize: 14 },
  pay: { color: "#16a34a", fontSize: 12, marginTop: 1 },
  empty: { textAlign: "center", color: "#999", marginTop: 24 },
  selectionBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    backgroundColor: "#f7f8fa",
    gap: 8,
  },
  selectionAction: { paddingHorizontal: 6, paddingVertical: 4 },
  selectionActionText: { color: "#2563eb", fontWeight: "600", fontSize: 13 },
  selectionCount: { flex: 1, textAlign: "center", fontWeight: "600", fontSize: 13, color: "#333" },
});
