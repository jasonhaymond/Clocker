import { File, Paths } from "expo-file-system";
import * as MailComposer from "expo-mail-composer";
import * as Sharing from "expo-sharing";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { listBreaksForShifts, listJobs, listRateTiersForJobs, listRateVersionsForTiers, listShiftsInRange } from "../db/database";
import { useDateTimePicker } from "../lib/useDateTimePicker";
import { useDbRefresh } from "../lib/useDbRefresh";
import {
  buildCsv,
  buildEmailHtml,
  groupShiftsByJob,
  addDays,
  formatDuration,
  startOfDay,
  startOfMonth,
  startOfWeek,
  type Break,
  type Job,
  type RateTier,
  type RateVersion,
  type Shift,
} from "@clocker/shared";

type RangeKey = "thisWeek" | "lastWeek" | "thisMonth" | "last90" | "custom";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "thisWeek", label: "This Week" },
  { key: "lastWeek", label: "Last Week" },
  { key: "thisMonth", label: "This Month" },
  { key: "last90", label: "Last 90 Days" },
  { key: "custom", label: "Custom Range" },
];

// `custom` is handled separately (needs the user-picked start/end state) — every other
// key is a pure function of "today".
function rangeFor(key: Exclude<RangeKey, "custom">): { start: Date; end: Date; label: string } {
  const today = new Date();
  switch (key) {
    case "thisWeek": {
      const start = startOfWeek(today);
      return { start, end: addDays(start, 7), label: `Week of ${start.toLocaleDateString()}` };
    }
    case "lastWeek": {
      const start = addDays(startOfWeek(today), -7);
      return { start, end: addDays(start, 7), label: `Week of ${start.toLocaleDateString()}` };
    }
    case "thisMonth": {
      const start = startOfMonth(today);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      return { start, end, label: start.toLocaleDateString([], { month: "long", year: "numeric" }) };
    }
    case "last90": {
      const start = addDays(startOfDay(today), -90);
      return { start, end: addDays(startOfDay(today), 1), label: "Last 90 days" };
    }
  }
}

function defaultSubject(rangeLabel: string, jobName: string | null): string {
  return jobName ? `${jobName} Hours — ${rangeLabel}` : `Hours — ${rangeLabel}`;
}

export function ExportScreen() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState<string | "all">("all");
  const [rangeKey, setRangeKey] = useState<RangeKey>("thisWeek");
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [breaksByShift, setBreaksByShift] = useState<Record<string, Break[]>>({});
  const [tiers, setTiers] = useState<RateTier[]>([]);
  const [versions, setVersions] = useState<RateVersion[]>([]);

  const [recipients, setRecipients] = useState("");
  const [subject, setSubject] = useState("");
  const [subjectEdited, setSubjectEdited] = useState(false);
  const [includeEarnings, setIncludeEarnings] = useState(true);
  const [includeComments, setIncludeComments] = useState(true);
  const [includeTimes, setIncludeTimes] = useState(true);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [customStart, setCustomStart] = useState(() => startOfDay(new Date()));
  const [customEnd, setCustomEnd] = useState(() => startOfDay(new Date()));
  const { pick, modal: dateModal } = useDateTimePicker();

  const load = useCallback(() => {
    listJobs(true).then(setJobs);
  }, []);
  useDbRefresh(load);

  const range = useMemo(() => {
    if (rangeKey === "custom") {
      const start = customStart;
      const end = addDays(customEnd, 1);
      const label = start.getTime() === customEnd.getTime() ? start.toLocaleDateString() : `${start.toLocaleDateString()} – ${customEnd.toLocaleDateString()}`;
      return { start, end, label };
    }
    return rangeFor(rangeKey);
  }, [rangeKey, customStart, customEnd]);

  async function pickCustomStart() {
    const date = await pick(customStart, "Start Date");
    if (!date) return;
    const day = startOfDay(date);
    setCustomStart(day);
    if (day.getTime() > customEnd.getTime()) setCustomEnd(day);
  }

  async function pickCustomEnd() {
    const date = await pick(customEnd, "End Date");
    if (!date) return;
    const day = startOfDay(date);
    if (day.getTime() < customStart.getTime()) {
      Alert.alert("Invalid range", "End date can't be before the start date.");
      return;
    }
    setCustomEnd(day);
  }

  useDbRefresh(
    useCallback(() => {
      listShiftsInRange(range.start.toISOString(), range.end.toISOString(), jobId === "all" ? undefined : jobId).then(
        async (rows) => {
          setShifts(rows);
          const jobIds = Array.from(new Set(rows.map((r) => r.jobId)));
          const [breaks, jobTiers] = await Promise.all([
            listBreaksForShifts(rows.map((r) => r.id)),
            listRateTiersForJobs(jobIds),
          ]);
          const grouped: Record<string, Break[]> = {};
          for (const b of breaks) (grouped[b.shiftId] ??= []).push(b);
          setBreaksByShift(grouped);
          setTiers(jobTiers);
          setVersions(await listRateVersionsForTiers(jobTiers.map((t) => t.id)));
        },
      );
    }, [range, jobId]),
  );

  const jobsById = useMemo(() => Object.fromEntries(jobs.map((j) => [j.id, j])), [jobs]);
  const { groups, payByShiftId } = useMemo(
    () => groupShiftsByJob({ shifts, jobsById, tiers, versions, breaksByShift }),
    [shifts, jobsById, tiers, versions, breaksByShift],
  );
  const totalHours = groups.reduce((sum, g) => sum + g.totalHours, 0);

  useEffect(() => {
    if (subjectEdited) return;
    const jobName = jobId === "all" ? null : jobsById[jobId]?.name ?? null;
    setSubject(defaultSubject(range.label, jobName));
  }, [range, jobId, jobsById, subjectEdited]);

  async function exportCsv() {
    if (shifts.length === 0) {
      Alert.alert("Nothing to export", "There are no shifts in this range.");
      return;
    }
    if (Platform.OS === "web") {
      Alert.alert("Not supported", "CSV export is available on iOS and Android. Use the mobile app to export.");
      return;
    }
    try {
      const csv = buildCsv(groups, payByShiftId, breaksByShift);
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

  async function sendEmail() {
    if (shifts.length === 0) {
      Alert.alert("Nothing to export", "There are no shifts in this range.");
      return;
    }
    const recipientList = recipients
      .split(/[,\s]+/)
      .map((r) => r.trim())
      .filter(Boolean);

    setSendingEmail(true);
    try {
      const available = await MailComposer.isAvailableAsync();
      if (!available) {
        Alert.alert("No email app found", "Set up a Mail app on this device, or use Export CSV instead.");
        return;
      }
      const html = buildEmailHtml({
        groups,
        payByShiftId,
        breaksByShift,
        rangeLabel: range.label,
        options: { includeEarnings, includeComments, includeTimes },
      });
      await MailComposer.composeAsync({
        recipients: recipientList,
        subject,
        body: html,
        isHtml: true,
      });
    } catch (e: any) {
      Alert.alert("Couldn't open email draft", e?.message ?? "Unknown error");
    } finally {
      setSendingEmail(false);
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

      {rangeKey === "custom" && (
        <View style={styles.customRangeRow}>
          <TouchableOpacity style={styles.customDateButton} onPress={pickCustomStart}>
            <Text style={styles.customDateLabel}>Start</Text>
            <Text style={styles.customDateValue}>{customStart.toLocaleDateString()}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.customDateButton} onPress={pickCustomEnd}>
            <Text style={styles.customDateLabel}>End</Text>
            <Text style={styles.customDateValue}>{customEnd.toLocaleDateString()}</Text>
          </TouchableOpacity>
        </View>
      )}

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
        <Text style={styles.summaryValue}>{formatDuration(totalHours * 3_600_000)}</Text>
      </View>

      <TouchableOpacity style={styles.exportButton} onPress={exportCsv}>
        <Text style={styles.exportButtonText}>Export CSV</Text>
      </TouchableOpacity>

      <View style={styles.divider} />

      <Text style={styles.sectionLabel}>Email as a draft</Text>
      <TextInput
        style={styles.input}
        placeholder="Email to (comma-separated)"
        autoCapitalize="none"
        keyboardType="email-address"
        value={recipients}
        onChangeText={setRecipients}
      />
      <TextInput
        style={styles.input}
        placeholder="Subject"
        value={subject}
        onChangeText={(v) => {
          setSubject(v);
          setSubjectEdited(true);
        }}
      />

      <View style={styles.optionRow}>
        <Text style={styles.optionLabel}>Include earnings</Text>
        <Switch value={includeEarnings} onValueChange={setIncludeEarnings} />
      </View>
      <View style={styles.optionRow}>
        <Text style={styles.optionLabel}>Include comments</Text>
        <Switch value={includeComments} onValueChange={setIncludeComments} />
      </View>
      <View style={styles.optionRow}>
        <Text style={styles.optionLabel}>Include start/end times</Text>
        <Switch value={includeTimes} onValueChange={setIncludeTimes} />
      </View>

      <TouchableOpacity style={[styles.exportButton, styles.emailButton]} onPress={sendEmail} disabled={sendingEmail}>
        {sendingEmail ? <ActivityIndicator color="#fff" /> : <Text style={styles.exportButtonText}>Create Email Draft</Text>}
      </TouchableOpacity>
      {dateModal}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 14, paddingBottom: 40 },
  sectionLabel: { fontWeight: "600", color: "#444", marginBottom: 6, marginTop: 8, fontSize: 13 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderColor: "#ddd", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  customRangeRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  customDateButton: { flex: 1, borderWidth: 1, borderColor: "#ddd", borderRadius: 10, padding: 10, alignItems: "center" },
  customDateLabel: { fontSize: 11, color: "#999" },
  customDateValue: { fontSize: 14, fontWeight: "600", marginTop: 2 },
  chipSelected: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  chipText: { color: "#333", fontSize: 13 },
  chipTextSelected: { color: "#fff", fontWeight: "600" },
  summary: { alignItems: "center", marginTop: 18, marginBottom: 14 },
  summaryLabel: { color: "#666", fontSize: 13 },
  summaryValue: { fontSize: 26, fontWeight: "700", marginTop: 2 },
  exportButton: { backgroundColor: "#16a34a", borderRadius: 10, padding: 12, alignItems: "center" },
  exportButtonText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  emailButton: { backgroundColor: "#2563eb", marginTop: 10 },
  divider: { height: 1, backgroundColor: "#eee", marginTop: 18 },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 9, marginBottom: 8, backgroundColor: "#fff" },
  optionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5 },
  optionLabel: { fontSize: 14, color: "#333" },
});
