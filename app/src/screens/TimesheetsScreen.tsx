import Ionicons from "@expo/vector-icons/Ionicons";
import { File, Paths } from "expo-file-system";
import * as MailComposer from "expo-mail-composer";
import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { TimesheetSettingsModal } from "../components/TimesheetSettingsModal";
import {
  listBreaksForShifts,
  listJobs,
  listManagersForIds,
  listRateTiersForJobs,
  listRateVersionsForTiers,
  listShiftsInRange,
} from "../db/database";
import { buildCsv, buildPlainText, groupShiftsByJob } from "../lib/exportFormat";
import { getTimesheetSettings, setTimesheetSettings, type TimesheetSettings } from "../lib/preferences";
import { formatClock, formatDay, formatDuration, workedMillis } from "../lib/time";
import { periodContaining, shiftPeriod, type Period } from "../lib/timesheetPeriods";
import { useDbRefresh } from "../lib/useDbRefresh";
import { formatCents } from "../lib/pay";
import type { Break, Job, RateTier, RateVersion, Shift } from "../types";

export function TimesheetsScreen() {
  const [settings, setSettings] = useState<TimesheetSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [period, setPeriod] = useState<Period | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [breaksByShift, setBreaksByShift] = useState<Record<string, Break[]>>({});
  const [tiers, setTiers] = useState<RateTier[]>([]);
  const [versions, setVersions] = useState<RateVersion[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useDbRefresh(
    useCallback(() => {
      getTimesheetSettings().then((s) => {
        setSettings(s);
        setPeriod((prev) => prev ?? periodContaining(new Date(), s));
      });
    }, []),
  );

  useDbRefresh(
    useCallback(() => {
      listJobs(true).then(setJobs);
    }, []),
  );

  useDbRefresh(
    useCallback(() => {
      if (!period) return;
      listShiftsInRange(period.start.toISOString(), period.end.toISOString()).then(async (rows) => {
        setShifts(rows);
        const jobIds = Array.from(new Set(rows.map((r) => r.jobId)));
        const [breaks, jobTiers] = await Promise.all([listBreaksForShifts(rows.map((r) => r.id)), listRateTiersForJobs(jobIds)]);
        const grouped: Record<string, Break[]> = {};
        for (const b of breaks) (grouped[b.shiftId] ??= []).push(b);
        setBreaksByShift(grouped);
        setTiers(jobTiers);
        setVersions(await listRateVersionsForTiers(jobTiers.map((t) => t.id)));
      });
    }, [period]),
  );

  const jobsById = useMemo(() => Object.fromEntries(jobs.map((j) => [j.id, j])), [jobs]);
  const { groups, payByShiftId } = useMemo(
    () => groupShiftsByJob({ shifts, jobsById, tiers, versions, breaksByShift }),
    [shifts, jobsById, tiers, versions, breaksByShift],
  );
  const totalHours = groups.reduce((sum, g) => sum + g.totalHours, 0);
  const totalCents = groups.reduce((sum, g) => sum + g.totalCents, 0);
  const anyRate = groups.some((g) => g.hasRate);

  function goToPeriod(offset: number) {
    if (!period || !settings) return;
    setPeriod(shiftPeriod(period, settings, offset));
  }

  function updateSettings(next: TimesheetSettings) {
    setSettings(next);
    setTimesheetSettings(next);
    setPeriod((prev) => (prev ? periodContaining(prev.start, next) : periodContaining(new Date(), next)));
  }

  async function submitTimesheet() {
    if (!settings || !period) return;
    if (shifts.length === 0) {
      Alert.alert("Nothing to submit", "There are no shifts in this period.");
      return;
    }
    if (settings.managerIds.length === 0) {
      Alert.alert("No recipients configured", "Open Timesheet Settings and add at least one manager.", [
        { text: "Cancel", style: "cancel" },
        { text: "Open Settings", onPress: () => setShowSettings(true) },
      ]);
      return;
    }
    setSubmitting(true);
    try {
      const managers = await listManagersForIds(settings.managerIds);
      const recipients = managers.filter((m) => !m.archived).map((m) => m.email);
      if (recipients.length === 0) {
        Alert.alert("No active recipients", "The selected managers are archived. Update Timesheet Settings.");
        return;
      }
      const available = await MailComposer.isAvailableAsync();
      if (!available) {
        Alert.alert("No email app found", "Set up a Mail app on this device to submit a timesheet.");
        return;
      }
      const options = { includeEarnings: settings.includeEarnings, includeComments: settings.includeNotes, includeTimes: settings.includeTimes };
      const subject = `Timesheet — ${period.label}`;
      const attachments: string[] = [];
      let body = `Timesheet for ${period.label}, ${totalHours.toFixed(2)} total hours.`;
      let isHtml = false;

      if (settings.format === "csv" || settings.format === "both") {
        const csv = buildCsv(groups, payByShiftId, breaksByShift);
        const file = new File(Paths.cache, `timesheet-${Date.now()}.csv`);
        file.create();
        file.write(csv);
        attachments.push(file.uri);
      }
      if (settings.format === "text" || settings.format === "both") {
        body = buildPlainText({ groups, payByShiftId, breaksByShift, rangeLabel: period.label, options });
      }

      await MailComposer.composeAsync({ recipients, subject, body, isHtml, attachments });
    } catch (e: any) {
      Alert.alert("Couldn't submit timesheet", e?.message ?? "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  if (!settings || !period) return null;

  return (
    <View style={styles.screen}>
      <View style={styles.periodBar}>
        <TouchableOpacity onPress={() => goToPeriod(-1)} style={styles.periodArrow}>
          <Ionicons name="chevron-back" size={20} color="#2563eb" />
        </TouchableOpacity>
        <Text style={styles.periodLabel}>{period.label}</Text>
        <TouchableOpacity onPress={() => goToPeriod(1)} style={styles.periodArrow}>
          <Ionicons name="chevron-forward" size={20} color="#2563eb" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowSettings(true)} style={styles.settingsButton}>
          <Ionicons name="settings-outline" size={20} color="#666" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.totalsRow}>
          <Text style={styles.totalsHours}>{formatDuration(totalHours * 3_600_000)}</Text>
          {settings.includeEarnings && anyRate && <Text style={styles.totalsPay}>{formatCents(totalCents)}</Text>}
        </View>

        {groups.length === 0 && <Text style={styles.empty}>No shifts in this period.</Text>}

        {groups.map((group) => (
          <View key={group.jobId} style={styles.jobCard}>
            <View style={styles.jobHeader}>
              <View style={[styles.dot, { backgroundColor: group.job?.colorHex ?? "#999" }]} />
              <Text style={styles.jobName}>{group.job?.name ?? "Deleted job"}</Text>
              <Text style={styles.jobHours}>{group.totalHours.toFixed(2)}h</Text>
              {settings.includeEarnings && group.hasRate && <Text style={styles.jobPay}>{formatCents(group.totalCents)}</Text>}
            </View>
            {group.shifts.map((shift) => {
              const worked = workedMillis(shift, breaksByShift[shift.id] ?? []) / 3_600_000;
              return (
                <View key={shift.id} style={styles.entryRow}>
                  <Text style={styles.entryDay}>{formatDay(shift.clockIn)}</Text>
                  {settings.includeTimes && (
                    <Text style={styles.entryTimes}>
                      {formatClock(shift.clockIn)} – {shift.clockOut ? formatClock(shift.clockOut) : "in progress"}
                    </Text>
                  )}
                  <Text style={styles.entryHours}>{worked.toFixed(2)}h</Text>
                  {settings.includeNotes && shift.notes ? (
                    <Text style={styles.entryNotes} numberOfLines={1}>
                      {shift.notes}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>

      <TouchableOpacity style={styles.submitButton} onPress={submitTimesheet} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>Submit Timesheet</Text>}
      </TouchableOpacity>

      {showSettings && <TimesheetSettingsModal settings={settings} onChange={updateSettings} onClose={() => setShowSettings(false)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  periodBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#eee" },
  periodArrow: { padding: 6 },
  periodLabel: { flex: 1, textAlign: "center", fontWeight: "700", fontSize: 15 },
  settingsButton: { padding: 6 },
  container: { padding: 12, paddingBottom: 90 },
  totalsRow: { flexDirection: "row", justifyContent: "center", alignItems: "baseline", gap: 10, marginVertical: 10 },
  totalsHours: { fontSize: 26, fontWeight: "700" },
  totalsPay: { fontSize: 16, color: "#16a34a", fontWeight: "600" },
  empty: { textAlign: "center", color: "#999", marginTop: 24 },
  jobCard: { backgroundColor: "#f7f8fa", borderRadius: 10, padding: 10, marginBottom: 10 },
  jobHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  jobName: { flex: 1, fontWeight: "600", fontSize: 14 },
  jobHours: { fontWeight: "600", fontSize: 13 },
  jobPay: { color: "#16a34a", fontSize: 12, marginLeft: 6 },
  entryRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, paddingVertical: 4, borderTopWidth: 1, borderTopColor: "#eee" },
  entryDay: { fontSize: 12, color: "#444", width: 76 },
  entryTimes: { fontSize: 12, color: "#666" },
  entryHours: { fontSize: 12, fontWeight: "600", marginLeft: "auto" },
  entryNotes: { fontSize: 11, color: "#999", fontStyle: "italic", width: "100%" },
  submitButton: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: "#2563eb",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
  },
  submitButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
