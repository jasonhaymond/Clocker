import React, { useCallback, useMemo, useState } from "react";
import { Alert, SectionList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { deleteShift, listBreaksForShifts, listJobs, listShiftsInRange } from "../db/database";
import { formatClock, formatDay, formatDuration, startOfDay, addDays, workedMillis } from "../lib/time";
import { useDbRefresh } from "../lib/useDbRefresh";
import type { Break, Job, Shift } from "../types";

const DAYS_BACK = 90;

export function HistoryScreen() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [breaksByShift, setBreaksByShift] = useState<Record<string, Break[]>>({});
  const [jobsById, setJobsById] = useState<Record<string, Job>>({});

  const load = useCallback(() => {
    const start = addDays(startOfDay(new Date()), -DAYS_BACK);
    const end = addDays(startOfDay(new Date()), 1);
    Promise.all([listShiftsInRange(start.toISOString(), end.toISOString()), listJobs(true)]).then(async ([shiftRows, jobRows]) => {
      setShifts(shiftRows);
      setJobsById(Object.fromEntries(jobRows.map((j) => [j.id, j])));
      const breaks = await listBreaksForShifts(shiftRows.map((s) => s.id));
      const grouped: Record<string, Break[]> = {};
      for (const b of breaks) {
        (grouped[b.shiftId] ??= []).push(b);
      }
      setBreaksByShift(grouped);
    });
  }, []);
  useDbRefresh(load);

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
        return (
          <TouchableOpacity style={styles.row} onLongPress={() => confirmDelete(item)}>
            <View style={[styles.dot, { backgroundColor: job?.colorHex ?? "#999" }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.jobName}>{job?.name ?? "Deleted job"}</Text>
              <Text style={styles.times}>
                {formatClock(item.clockIn)} – {item.clockOut ? formatClock(item.clockOut) : "in progress"}
                {shiftBreaks.length > 0 ? ` · ${shiftBreaks.length} break${shiftBreaks.length > 1 ? "s" : ""}` : ""}
              </Text>
            </View>
            <Text style={styles.duration}>{formatDuration(worked)}</Text>
          </TouchableOpacity>
        );
      }}
      ListEmptyComponent={<Text style={styles.empty}>No shifts in the last {DAYS_BACK} days.</Text>}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  sectionHeader: { fontWeight: "700", fontSize: 14, color: "#444", backgroundColor: "#fff", paddingVertical: 8 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#eee", gap: 10 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  jobName: { fontSize: 16, fontWeight: "500" },
  times: { color: "#666", fontSize: 13, marginTop: 2 },
  duration: { fontWeight: "600" },
  empty: { textAlign: "center", color: "#999", marginTop: 24 },
});
