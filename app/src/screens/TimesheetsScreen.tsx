import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import * as MailComposer from "expo-mail-composer";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { JobDetailModal } from "./JobDetailModal";
import {
  listBreaksForShifts,
  listJobManagers,
  listJobs,
  listManagersForIds,
  listRateTiersForJobs,
  listRateVersionsForTiers,
  listShiftsInRange,
} from "../db/database";
import { createInvoice, type Invoice } from "../sync/api";
import { useDbRefresh } from "../lib/useDbRefresh";
import { useTheme, type ThemeColors } from "../theme/ThemeContext";
import {
  buildCsv,
  buildPlainText,
  groupShiftsByJob,
  formatClock,
  formatDay,
  formatDuration,
  roundedWorkedMillis,
  jobPeriodSettings,
  periodContaining,
  shiftPeriod,
  formatCents,
  type Period,
  type Break,
  type Job,
  type RateTier,
  type RateVersion,
  type Shift,
} from "@clocker/shared";

export function TimesheetsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [breaksByShift, setBreaksByShift] = useState<Record<string, Break[]>>({});
  const [tiers, setTiers] = useState<RateTier[]>([]);
  const [versions, setVersions] = useState<RateVersion[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [invoiceBusy, setInvoiceBusy] = useState(false);

  useDbRefresh(
    useCallback(() => {
      // Archived jobs are hidden everywhere except the Jobs screen itself.
      listJobs(false).then(setJobs);
    }, []),
  );

  useEffect(() => {
    if (selectedJobId && jobs.some((j) => j.id === selectedJobId)) return;
    setSelectedJobId(jobs[0]?.id ?? null);
  }, [jobs, selectedJobId]);

  const job = jobs.find((j) => j.id === selectedJobId) ?? null;

  // Switching jobs resets to that job's current period rather than trying to preserve a
  // navigation position across jobs with potentially different period definitions.
  useEffect(() => {
    if (job) setPeriod(periodContaining(new Date(), jobPeriodSettings(job)));
  }, [job?.id]);

  useDbRefresh(
    useCallback(() => {
      if (!job || !period) return;
      listShiftsInRange(period.start.toISOString(), period.end.toISOString(), job.id).then(async (rows) => {
        setShifts(rows);
        const [breaks, jobTiers] = await Promise.all([listBreaksForShifts(rows.map((r) => r.id)), listRateTiersForJobs([job.id])]);
        const grouped: Record<string, Break[]> = {};
        for (const b of breaks) (grouped[b.shiftId] ??= []).push(b);
        setBreaksByShift(grouped);
        setTiers(jobTiers);
        setVersions(await listRateVersionsForTiers(jobTiers.map((t) => t.id)));
      });
    }, [job?.id, period]),
  );

  const jobsById = useMemo(() => (job ? { [job.id]: job } : {}), [job]);
  const { groups, payByShiftId } = useMemo(
    () => groupShiftsByJob({ shifts, jobsById, tiers, versions, breaksByShift }),
    [shifts, jobsById, tiers, versions, breaksByShift],
  );
  const group = groups[0];
  const totalHours = group?.totalHours ?? 0;
  const totalCents = group?.totalCents ?? 0;

  function goToPeriod(offset: number) {
    if (!period || !job) return;
    setPeriod(shiftPeriod(period, jobPeriodSettings(job), offset));
  }

  // A stale invoice/link from a previous job or period shouldn't linger once either
  // changes — regenerating is cheap and avoids ever showing a link for the wrong data.
  useEffect(() => {
    setInvoice(null);
  }, [job?.id, period?.start.getTime()]);

  // The invoice's line items/total are computed once, server-side, from this exact job +
  // period at generation time — a real financial-document snapshot, not something this
  // screen recomputes live the way the preview above does (see
  // server/src/routes/invoices.ts).
  async function generateInvoice() {
    if (!job || !period) return;
    setInvoiceBusy(true);
    try {
      setInvoice(await createInvoice(job.id, period.start.toISOString(), period.end.toISOString(), period.label));
    } catch (e: any) {
      Alert.alert("Couldn't generate invoice", e?.message ?? "Unknown error");
    } finally {
      setInvoiceBusy(false);
    }
  }

  async function emailInvoice() {
    if (!invoice || !job) return;
    const available = await MailComposer.isAvailableAsync();
    if (!available) {
      Alert.alert("No email app found", "Set up a Mail app on this device to email an invoice.");
      return;
    }
    await MailComposer.composeAsync({
      subject: `Invoice from ${job.name} — ${invoice.rangeLabel}`,
      body:
        `Here's your invoice for ${invoice.rangeLabel}:\n\n${invoice.shareUrl}\n\n` +
        `Total: ${formatCents(invoice.totalCents)} (${invoice.totalHours.toFixed(2)} hrs). ` +
        `A downloadable PDF is available at that link.`,
    });
  }

  async function submitTimesheet() {
    if (!job || !period) return;
    if (shifts.length === 0) {
      Alert.alert("Nothing to submit", "There are no shifts in this period.");
      return;
    }
    const assignments = await listJobManagers(job.id);
    if (assignments.length === 0) {
      Alert.alert("No recipients configured", "Open this job's settings and assign at least one manager.", [
        { text: "Cancel", style: "cancel" },
        { text: "Open Settings", onPress: () => setEditingJob(job) },
      ]);
      return;
    }
    setSubmitting(true);
    try {
      const managers = await listManagersForIds(assignments.map((a) => a.managerId));
      const recipients = managers.filter((m) => !m.archived).map((m) => m.email);
      if (recipients.length === 0) {
        Alert.alert("No active recipients", "The managers assigned to this job are archived. Update this job's settings.");
        return;
      }
      const available = await MailComposer.isAvailableAsync();
      if (!available) {
        Alert.alert("No email app found", "Set up a Mail app on this device to submit a timesheet.");
        return;
      }
      const options = {
        includeEarnings: job.timesheetIncludeEarnings,
        includeComments: job.timesheetIncludeNotes,
        includeTimes: job.timesheetIncludeTimes,
      };
      const subject = `${job.name} Timesheet — ${period.label}`;
      const attachments: string[] = [];
      let body = `Timesheet for ${job.name}, ${period.label}: ${totalHours.toFixed(2)} total hours.`;
      let isHtml = false;

      if (job.timesheetFormat === "csv" || job.timesheetFormat === "both") {
        const csv = buildCsv(groups, payByShiftId, breaksByShift);
        const file = new File(Paths.cache, `timesheet-${Date.now()}.csv`);
        file.create();
        file.write(csv);
        attachments.push(file.uri);
      }
      if (job.timesheetFormat === "text" || job.timesheetFormat === "both") {
        body = buildPlainText({ groups, payByShiftId, breaksByShift, rangeLabel: period.label, options });
      }

      await MailComposer.composeAsync({ recipients, subject, body, isHtml, attachments });
    } catch (e: any) {
      Alert.alert("Couldn't submit timesheet", e?.message ?? "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  if (jobs.length === 0) {
    return (
      <View style={styles.screen}>
        <Text style={styles.empty}>Add a job in the Jobs tab first.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.jobBar}>
        {jobs.map((j) => (
          <TouchableOpacity
            key={j.id}
            style={[styles.jobChip, { borderColor: j.colorHex }, selectedJobId === j.id && { backgroundColor: j.colorHex }]}
            onPress={() => setSelectedJobId(j.id)}
          >
            <Text style={[styles.jobChipText, selectedJobId === j.id && styles.jobChipTextSelected]}>{j.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {job && period && (
        <>
          <View style={styles.periodBar}>
            <TouchableOpacity onPress={() => goToPeriod(-1)} style={styles.periodArrow}>
              <Ionicons name="chevron-back" size={20} color={colors.primary} />
            </TouchableOpacity>
            <Text style={styles.periodLabel}>{period.label}</Text>
            <TouchableOpacity onPress={() => goToPeriod(1)} style={styles.periodArrow}>
              <Ionicons name="chevron-forward" size={20} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setEditingJob(job)} style={styles.settingsButton}>
              <Ionicons name="settings-outline" size={20} color={colors.textMuted3} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.container}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsHours}>{formatDuration(totalHours * 3_600_000)}</Text>
              {job.timesheetIncludeEarnings && group?.hasRate && <Text style={styles.totalsPay}>{formatCents(totalCents)}</Text>}
            </View>

            {!group && <Text style={styles.empty}>No shifts in this period.</Text>}

            {group?.shifts.map((shift) => {
              const worked = roundedWorkedMillis(shift, breaksByShift[shift.id] ?? [], job) / 3_600_000;
              return (
                <View key={shift.id} style={styles.entryRow}>
                  <Text style={styles.entryDay}>{formatDay(shift.clockIn)}</Text>
                  {job.timesheetIncludeTimes && (
                    <Text style={styles.entryTimes}>
                      {formatClock(shift.clockIn)} – {shift.clockOut ? formatClock(shift.clockOut) : "in progress"}
                    </Text>
                  )}
                  <Text style={styles.entryHours}>{worked.toFixed(2)}h</Text>
                  {job.timesheetIncludeNotes && shift.notes ? (
                    <Text style={styles.entryNotes} numberOfLines={1}>
                      {shift.notes}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.bottomBar}>
            <TouchableOpacity style={styles.submitButton} onPress={submitTimesheet} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>Submit Timesheet</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={generateInvoice} disabled={invoiceBusy || !group}>
              {invoiceBusy ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.secondaryButtonText}>Generate Invoice</Text>}
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* A separate modal rather than expanding the floating bottom bar above — that bar
          is deliberately kept small so it doesn't cover much of the scrollable shift list
          behind it; a growing result panel there would fight with that. */}
      {invoice && (
        <Modal visible animationType="slide" transparent onRequestClose={() => setInvoice(null)}>
          <View style={styles.invoiceModalBackdrop}>
            <View style={styles.invoiceModalCard}>
              <Text style={styles.invoiceModalTitle}>Invoice Generated</Text>
              <Text style={styles.hint}>
                {invoice.totalHours.toFixed(2)} hrs · {formatCents(invoice.totalCents)}
              </Text>
              <Text style={styles.invoiceLink} numberOfLines={1}>
                {invoice.shareUrl}
              </Text>
              <View style={styles.invoiceActionsRow}>
                <TouchableOpacity style={styles.invoiceActionButton} onPress={() => Clipboard.setStringAsync(invoice.shareUrl)}>
                  <Text style={styles.secondaryButtonText}>Copy Link</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.invoiceActionButton} onPress={emailInvoice}>
                  <Text style={styles.secondaryButtonText}>Send by Email</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.hint}>
                Anyone with this link can view (and download the PDF for) this one invoice — no Clocker account
                needed. It won't change even if this job's rates or hours are edited later.
              </Text>
              <TouchableOpacity style={styles.invoiceCloseButton} onPress={() => setInvoice(null)}>
                <Text style={styles.secondaryButtonText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {editingJob && <JobDetailModal job={editingJob} onClose={() => setEditingJob(null)} />}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.card },
    // alignItems: "flex-start" is load-bearing, not decorative: a horizontal ScrollView's
    // content container defaults to alignItems "stretch" like any row, and on Android that
    // stretches every chip to the ScrollView's full available height instead of just
    // matching its siblings' content height (every OTHER chip row in this app uses
    // flexWrap instead of a horizontal ScrollView, which sidesteps this — this is the only
    // one that didn't). alignSelf on jobChip itself is a second, redundant guard against
    // the same failure mode.
    jobBar: { paddingHorizontal: 10, paddingVertical: 8, gap: 6, borderBottomWidth: 1, borderBottomColor: colors.border, alignItems: "flex-start" },
    jobChip: { borderWidth: 2, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginRight: 6, alignSelf: "flex-start", backgroundColor: colors.card },
    jobChipText: { fontWeight: "600", fontSize: 13, color: colors.text },
    jobChipTextSelected: { color: "#fff" },
    periodBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
    periodArrow: { padding: 6 },
    periodLabel: { flex: 1, textAlign: "center", fontWeight: "700", fontSize: 15, color: colors.text },
    settingsButton: { padding: 6 },
    // Bumped from the single-submit-button era to clear the now-two-button bottomBar
    // stacked above it, so the last shift entries in the scrollable list above never sit
    // behind either floating button.
    container: { padding: 12, paddingBottom: 150 },
    totalsRow: { flexDirection: "row", justifyContent: "center", alignItems: "baseline", gap: 10, marginVertical: 10 },
    totalsHours: { fontSize: 26, fontWeight: "700", color: colors.text },
    totalsPay: { fontSize: 16, color: colors.success, fontWeight: "600" },
    empty: { textAlign: "center", color: colors.textMuted2, marginTop: 24 },
    entryRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
      paddingVertical: 6,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    entryDay: { fontSize: 12, color: colors.textSecondary, width: 76 },
    entryTimes: { fontSize: 12, color: colors.textMuted3 },
    entryHours: { fontSize: 12, fontWeight: "600", marginLeft: "auto", color: colors.text },
    entryNotes: { fontSize: 11, color: colors.textMuted2, fontStyle: "italic", width: "100%" },
    bottomBar: { position: "absolute", left: 12, right: 12, bottom: 12, gap: 8 },
    submitButton: {
      backgroundColor: colors.primaryFill,
      borderRadius: 12,
      padding: 14,
      alignItems: "center",
    },
    submitButtonText: { color: colors.onPrimary, fontWeight: "700", fontSize: 15 },
    secondaryButton: {
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 12,
      alignItems: "center",
    },
    secondaryButtonText: { color: colors.primary, fontWeight: "700", fontSize: 14 },
    hint: { fontSize: 11, color: colors.textMuted2, lineHeight: 16 },
    invoiceModalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 20 },
    invoiceModalCard: { backgroundColor: colors.card, borderRadius: 14, padding: 18, gap: 8 },
    invoiceModalTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
    invoiceLink: { color: colors.primary, fontSize: 13 },
    invoiceActionsRow: { flexDirection: "row", gap: 8, marginVertical: 4 },
    invoiceActionButton: { flex: 1, borderWidth: 1, borderColor: colors.primary, borderRadius: 10, padding: 10, alignItems: "center" },
    invoiceCloseButton: { alignItems: "center", padding: 10, marginTop: 4 },
  });
}
