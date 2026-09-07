import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import React, { useCallback, useMemo, useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { listBreaksForShifts, listJobs, listShiftsInRange } from "../db/database";
import { addDays, formatDuration, startOfDay, startOfMonth, startOfWeek, workedMillis } from "../lib/time";
import { useDbRefresh } from "../lib/useDbRefresh";
import type { Job, Shift } from "../types";

type RangeKey = "thisWeek" | "lastWeek" | "thisMonth" | "last90";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "thisWeek", label: "This Week" },
  { key: "lastWeek", label: "Last Week" },
  { key: "thisMonth", label: "This Month" },
  { key: "last90", label: "Last 90 Days" },
];

function rangeFor(key: RangeKey): { start: Date; end: Date } {
  const today = new Date();
  switch (key) {
    case "thisWeek": {
      const start = startOfWeek(today);
      return { start, end: addDays(start, 7) };
    }
    case "lastWeek": {
      const start = addDays(startOfWeek(today), -7);
      return { start, end: addDays(start, 7) };
    }
    case "thisMonth": {
      const start = startOfMonth(today);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      return { start, end };
    }
    case "last90":
      return { start: addDays(startOfDay(today), -90), end: addDays(startOfDay(today), 1) };
  }
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function ExportScreen() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState<string | "all">("all");
  const [rangeKey, setRangeKey] = useState<RangeKey>("thisWeek");
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [breaksByShift, setBreaksByShift] = useState<Record<string, { start: string; end: string | null }[]>>({});

  const load = useCallback(() => {
    listJobs(true).then(setJobs);
  }, []);
  useDbRefresh(load);

  const range = useMemo(() => rangeFor(rangeKey), [rangeKey]);

  useDbRefresh(
    useCallback(() => {
      listShiftsInRange(range.start.toISOString(), range.end.toISOString(), jobId === "all" ? undefined : jobId).then(
        async (rows) => {
          setShifts(rows);
          const breaks = await listBreaksForShifts(rows.map((r) => r.id));
          const grouped: Record<string, { start: string; end: string | null }[]> = {};
          for (const b of breaks) (grouped[b.shiftId] ??= []).push({ start: b.start, end: b.end });
          setBreaksByShift(grouped);
        },
      );
    }, [range, jobId]),
  );

  const jobsById = useMemo(() => Object.fromEntries(jobs.map((j) => [j.id, j])), [jobs]);
  const totalMs = shifts.reduce((sum, s) => sum + workedMillis(s, (breaksByShift[s.id] ?? []) as any), 0);

  async function exportCsv() {
    if (shifts.length === 0) {
      Alert.alert("Nothing to export", "There are no shifts in this range.");
      return;
    }

    const header = ["Job", "Clock In", "Clock Out", "Break (hrs)", "Worked (hrs)", "Rate", "Pay", "Notes"];
    const rows = [...shifts]
      .sort((a, b) => (a.clockIn < b.clockIn ? -1 : 1))
      .map((shift) => {
        const job = jobsById[shift.jobId];
        const breaks = (breaksByShift[shift.id] ?? []) as any;
        const breakHrs = breaks.reduce((sum: number, b: any) => {
          const end = b.end ? new Date(b.end).getTime() : Date.now();
          return sum + (end - new Date(b.start).getTime());
        }, 0) / 3_600_000;
        const workedHrs = workedMillis(shift, breaks) / 3_600_000;
        const rate = job?.hourlyRateCents != null ? job.hourlyRateCents / 100 : null;
        return [
          job?.name ?? "Deleted job",
          new Date(shift.clockIn).toLocaleString(),
          shift.clockOut ? new Date(shift.clockOut).toLocaleString() : "",
          breakHrs.toFixed(2),
          workedHrs.toFixed(2),
          rate != null ? rate.toFixed(2) : "",
          rate != null ? (rate * workedHrs).toFixed(2) : "",
          shift.notes ?? "",
        ];
      });

    const csv = [header, ...rows].map((cols) => cols.map((c) => csvEscape(String(c))).join(",")).join("\n");

    if (Platform.OS === "web") {
      Alert.alert("Not supported", "CSV export is available on iOS and Android. Use the mobile app to export.");
      return;
    }

    try {
      const file = new File(Paths.cache, `clocker-export-${Date.now()}.csv`);
      file.create();
      file.write(csv);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: "text/csv", dialogTitle: "Export Timesheet" });
      } else {
        Alert.alert("Saved", `Exported to ${file.uri}`);
      }
    } catch (e: any) {
      Alert.alert("Export failed", e?.message ?? "Unknown error");
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.sectionLabel}>Range</Text>
      <View style={styles.chipRow}>
        {RANGES.map((r) => (
          <TouchableOpacity key={r.key} style={[styles.chip, rangeKey === r.key && styles.chipSelected]} onPress={() => setRangeKey(r.key)}>
            <Text style={[styles.chipText, rangeKey === r.key && styles.chipTextSelected]}>{r.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionLabel}>Job</Text>
      <View style={styles.chipRow}>
        <TouchableOpacity style={[styles.chip, jobId === "all" && styles.chipSelected]} onPress={() => setJobId("all")}>
          <Text style={[styles.chipText, jobId === "all" && styles.chipTextSelected]}>All Jobs</Text>
        </TouchableOpacity>
        {jobs.map((job) => (
          <TouchableOpacity key={job.id} style={[styles.chip, jobId === job.id && styles.chipSelected]} onPress={() => setJobId(job.id)}>
            <Text style={[styles.chipText, jobId === job.id && styles.chipTextSelected]}>{job.name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.summary}>
        <Text style={styles.summaryLabel}>{shifts.length} shift{shifts.length === 1 ? "" : "s"}</Text>
        <Text style={styles.summaryValue}>{formatDuration(totalMs)}</Text>
      </View>

      <TouchableOpacity style={styles.exportButton} onPress={exportCsv}>
        <Text style={styles.exportButtonText}>Export CSV</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20 },
  sectionLabel: { fontWeight: "600", color: "#444", marginBottom: 8, marginTop: 12 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: "#ddd", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
  chipSelected: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  chipText: { color: "#333" },
  chipTextSelected: { color: "#fff", fontWeight: "600" },
  summary: { alignItems: "center", marginTop: 32, marginBottom: 24 },
  summaryLabel: { color: "#666" },
  summaryValue: { fontSize: 32, fontWeight: "700", marginTop: 4 },
  exportButton: { backgroundColor: "#16a34a", borderRadius: 12, padding: 16, alignItems: "center" },
  exportButtonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
