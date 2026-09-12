import Ionicons from "@expo/vector-icons/Ionicons";
import React, { useCallback, useMemo, useState } from "react";
import { Alert, SectionList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";
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
import { useTheme, type ThemeColors } from "../theme/ThemeContext";
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
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
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

  // Total across everything currently loaded (the last DAYS_BACK days) — only counts
  // shifts that actually resolved to a real rate, same condition each row already checks
  // before showing its own pay figure.
  const totalCents = useMemo(() => {
    let sum = 0;
    for (const pay of payByShiftId.values()) {
      if (pay.rateCentsPerHour != null) sum += pay.totalCents;
    }
    return sum;
  }, [payByShiftId]);

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
      {!selectionMode && shifts.length > 0 && totalCents > 0 && (
        <View style={styles.totalBar}>
          <Text style={styles.totalLabel}>Total earned (last {DAYS_BACK} days)</Text>
          <Text style={styles.totalValue}>{formatCents(totalCents)}</Text>
        </View>
      )}
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
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
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
            <Swipeable
              enabled={!selectionMode}
              overshootRight={false}
              renderRightActions={() => (
                <TouchableOpacity style={styles.swipeDeleteAction} onPress={() => confirmDelete(item)}>
                  <Ionicons name="trash-outline" size={22} color="#fff" />
                </TouchableOpacity>
              )}
            >
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
            </Swipeable>
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

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.card },
    sectionHeader: { fontWeight: "700", fontSize: 13, color: colors.textSecondary, backgroundColor: colors.card, paddingVertical: 5 },
    // Needs an explicit (opaque) background — it's the child Swipeable slides to reveal
    // the red delete action sitting behind it; without one, the row would be transparent
    // and show the action through it even before swiping.
    row: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 8, backgroundColor: colors.card },
    rowSelected: { backgroundColor: colors.selectedBg },
    swipeDeleteAction: { backgroundColor: colors.danger, justifyContent: "center", alignItems: "center", width: 72 },
    checkboxBox: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: colors.textMuted2, alignItems: "center", justifyContent: "center" },
    checkboxBoxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
    dot: { width: 11, height: 11, borderRadius: 6 },
    jobName: { fontSize: 15, fontWeight: "500", color: colors.text },
    times: { color: colors.textMuted3, fontSize: 12, marginTop: 1 },
    notesPreview: { color: colors.textMuted2, fontSize: 11, marginTop: 1, fontStyle: "italic" },
    duration: { fontWeight: "600", fontSize: 14, color: colors.text },
    pay: { color: colors.success, fontSize: 12, marginTop: 1 },
    empty: { textAlign: "center", color: colors.textMuted2, marginTop: 24 },
    totalBar: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    totalLabel: { color: colors.textMuted3, fontSize: 12 },
    totalValue: { color: colors.success, fontSize: 16, fontWeight: "700" },
    selectionBar: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
      gap: 8,
    },
    selectionAction: { paddingHorizontal: 6, paddingVertical: 4 },
    selectionActionText: { color: colors.primary, fontWeight: "600", fontSize: 13 },
    selectionCount: { flex: 1, textAlign: "center", fontWeight: "600", fontSize: 13, color: colors.textSecondary },
  });
}
