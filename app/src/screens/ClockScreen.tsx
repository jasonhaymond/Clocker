import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { ShiftNotesModal } from "../components/ShiftNotesModal";
import {
  clockIn,
  clockOut,
  deleteShift,
  endBreak,
  getJob,
  getLastActivityByJob,
  getOpenBreak,
  getOpenShifts,
  listBreaksForShift,
  listBreaksForShifts,
  listJobs,
  listRateTiers,
  listRateTiersForJobs,
  listRateVersionsForTiers,
  listShiftsInRange,
  startBreak,
} from "../db/database";
import { requestClockedInNotificationPermission, updateClockedInNotification } from "../lib/clockedInNotification";
import { cancelStaleShiftReminder, scheduleStaleShiftReminder } from "../lib/staleShiftReminder";
import { useDbRefresh } from "../lib/useDbRefresh";
import { useDateTimePicker } from "../lib/useDateTimePicker";
import { synchronize } from "../sync/sync";
import { useTheme, type ThemeColors } from "../theme/ThemeContext";
import {
  addDays,
  calculateShiftPay,
  calculateWeeklyProgress,
  formatCents,
  formatClock,
  formatDuration,
  mostRecentWeekStart,
  workedMillis,
  type Break,
  type Job,
  type RateTier,
  type RateVersion,
  type Shift,
  type WeeklyProgress,
} from "@clocker/shared";

interface OpenShiftDetail {
  shift: Shift;
  job: Job | null;
  breaks: Break[];
  openBreak: Break | null;
}

export function ClockScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [lastActivityByJob, setLastActivityByJob] = useState<Record<string, string>>({});
  const [openShiftDetails, setOpenShiftDetails] = useState<OpenShiftDetail[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [tiers, setTiers] = useState<RateTier[]>([]);
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // Also opened manually (via the notes icon on an open shift's card), not just the
  // automatic post-clock-out prompt — same modal, same shape, either trigger.
  const [notesEditor, setNotesEditor] = useState<{ shiftId: string; notes: string | null } | null>(null);
  const [weekDataByJobId, setWeekDataByJobId] = useState<Record<string, { shifts: Shift[]; breaksByShift: Record<string, Break[]> }>>({});
  // Every job's rate tiers/versions, loaded once — needed to show live pay for an open
  // shift (below) the same way History/Timesheets/Export compute it for closed ones.
  const [allTiers, setAllTiers] = useState<RateTier[]>([]);
  const [allVersions, setAllVersions] = useState<RateVersion[]>([]);
  const { pick, modal } = useDateTimePicker();

  const load = useCallback(() => {
    listJobs(false).then(async (allJobs) => {
      setJobs(allJobs);
      const jobTiers = await listRateTiersForJobs(allJobs.map((j) => j.id));
      setAllTiers(jobTiers);
      setAllVersions(await listRateVersionsForTiers(jobTiers.map((t) => t.id)));
      // Only jobs with a weekly target need their week's shifts loaded — everything else
      // has nothing to compute. Each job can define its own week (expectedHoursWeekStartDay),
      // so the range is computed per job, not once for all of them.
      const targetJobs = allJobs.filter((j) => j.expectedWeeklyHours != null);
      const entries = await Promise.all(
        targetJobs.map(async (job): Promise<[string, { shifts: Shift[]; breaksByShift: Record<string, Break[]> }]> => {
          const weekStart = mostRecentWeekStart(new Date(), job.expectedHoursWeekStartDay);
          const weekEnd = addDays(weekStart, 7);
          const weekShifts = await listShiftsInRange(weekStart.toISOString(), weekEnd.toISOString(), job.id);
          const breaks = await listBreaksForShifts(weekShifts.map((s) => s.id));
          const breaksByShift: Record<string, Break[]> = {};
          for (const b of breaks) (breaksByShift[b.shiftId] ??= []).push(b);
          return [job.id, { shifts: weekShifts, breaksByShift }];
        }),
      );
      setWeekDataByJobId(Object.fromEntries(entries));
    });
    getLastActivityByJob().then(setLastActivityByJob);
    getOpenShifts().then(async (shifts) => {
      const details = await Promise.all(
        shifts.map(async (shift): Promise<OpenShiftDetail> => {
          const [job, shiftBreaks, openBreak] = await Promise.all([
            getJob(shift.jobId),
            listBreaksForShift(shift.id),
            getOpenBreak(shift.id),
          ]);
          return { shift, job, breaks: shiftBreaks, openBreak };
        }),
      );
      setOpenShiftDetails(details);
    });
  }, []);
  useDbRefresh(load);

  // A job already clocked in can't be picked for a second, simultaneous shift.
  const openJobIds = new Set(openShiftDetails.map((d) => d.shift.jobId));
  // Most-recently-used first (by last clock-in), so the job you'll likely want is both at
  // the top of the list and the one auto-selected below. Jobs never clocked into yet keep
  // their existing (alphabetical) order, after every job with activity.
  const availableJobs = jobs
    .filter((j) => !openJobIds.has(j.id))
    .slice()
    .sort((a, b) => {
      const aLast = lastActivityByJob[a.id];
      const bLast = lastActivityByJob[b.id];
      if (aLast && bLast) return bLast.localeCompare(aLast);
      if (aLast) return -1;
      if (bLast) return 1;
      return 0;
    });

  // Tracks whichever job this effect itself last auto-picked, so a manual tap on a
  // different (non-top) job isn't immediately clobbered the next time this runs — only a
  // selection that's still exactly what we last auto-picked is allowed to keep following
  // the top of the list as it changes (e.g. right after clocking out of it).
  const lastAutoTopRef = useRef<string | null>(null);
  useEffect(() => {
    const topJobId = availableJobs[0]?.id ?? null;
    const stillValid = selectedJobId && availableJobs.some((j) => j.id === selectedJobId);
    const followingAuto = !stillValid || selectedJobId === lastAutoTopRef.current;
    if (followingAuto && selectedJobId !== topJobId) setSelectedJobId(topJobId);
    lastAutoTopRef.current = topJobId;
  }, [availableJobs, selectedJobId]);

  useEffect(() => {
    if (!selectedJobId) {
      setTiers([]);
      setSelectedTierId(null);
      return;
    }
    listRateTiers(selectedJobId, false).then((jobTiers) => {
      setTiers(jobTiers);
      setSelectedTierId(jobTiers.find((t) => t.isDefault)?.id ?? jobTiers[0]?.id ?? null);
    });
  }, [selectedJobId]);

  // Re-render every 30s so elapsed timers stay live while any shift/break is open.
  useEffect(() => {
    if (openShiftDetails.length === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, [openShiftDetails.length]);

  useEffect(() => {
    requestClockedInNotificationPermission().catch(() => {});
  }, []);

  // Keeps the persistent Android "clocked in" notification (see clockedInNotification.ts)
  // in sync with actual open-shift state — driven by data, not this screen's mount state,
  // since navigating to another tab shouldn't drop the notification while still clocked
  // in. Also re-fires on the same 30s `tick` that keeps the in-app timer live, so the
  // notification's elapsed time doesn't go stale between actual DB changes.
  useEffect(() => {
    updateClockedInNotification(
      openShiftDetails.map(({ shift, job, breaks }) => ({
        jobName: job?.name ?? "Job",
        jobColorHex: job?.colorHex ?? colors.primaryFill,
        clockInIso: shift.clockIn,
        workedMs: workedMillis(shift, breaks),
      })),
    ).catch(() => {});
  }, [openShiftDetails, tick]);

  async function handleClockIn(customTime?: Date) {
    if (!selectedJobId) return;
    const tierId = tiers.length > 1 ? selectedTierId : null;
    try {
      const shift = await clockIn(selectedJobId, tierId, customTime?.toISOString());
      synchronize().catch(() => {});
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      // Post the notification immediately rather than waiting for the effect above to
      // notice the new open shift via the load()/dbEvents round trip — that round trip is
      // fast, but not instant, and "instant" is the whole point here.
      const job = jobs.find((j) => j.id === selectedJobId);
      if (job?.staleShiftReminderHours != null) {
        scheduleStaleShiftReminder({
          shiftId: shift.id,
          jobName: job.name,
          clockInIso: shift.clockIn,
          hours: job.staleShiftReminderHours,
        }).catch(() => {});
      }
      updateClockedInNotification([
        ...openShiftDetails.map(({ shift: s, job: j, breaks }) => ({
          jobName: j?.name ?? "Job",
          jobColorHex: j?.colorHex ?? colors.primaryFill,
          clockInIso: s.clockIn,
          workedMs: workedMillis(s, breaks),
        })),
        { jobName: job?.name ?? "Job", jobColorHex: job?.colorHex ?? colors.primaryFill, clockInIso: shift.clockIn, workedMs: 0 },
      ]).catch(() => {});
    } catch (e: any) {
      Alert.alert("Couldn't clock in", e?.message ?? "Unknown error");
    }
  }

  async function handleClockInAt() {
    const date = await pick(new Date(), "Clock In At");
    if (date) handleClockIn(date);
  }

  async function handleClockOut(shift: Shift, customTime?: Date) {
    // Only the immediate "Clock Out" button (no customTime) needs this guard — a shift
    // clocked in for later today (via "Start At...") hasn't started yet, so clocking out
    // "now" would record a clock-out before the clock-in, the exact backwards-shift bug
    // reported via screenshot. "Clock Out At..." has its own after-clock-in check already.
    if (!customTime && Date.now() < new Date(shift.clockIn).getTime()) {
      Alert.alert(
        "Not started yet",
        `This shift is scheduled to start at ${formatClock(shift.clockIn)}. Use the ✕ above to cancel it, or wait until then.`,
      );
      return;
    }
    await clockOut(shift.id, customTime?.toISOString());
    synchronize().catch(() => {});
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    cancelStaleShiftReminder(shift.id).catch(() => {});
    const job = jobs.find((j) => j.id === shift.jobId);
    if (job?.promptForNotesOnClockOut) setNotesEditor({ shiftId: shift.id, notes: shift.notes });
  }

  function confirmCancelClockIn(shift: Shift, job: Job | null) {
    Alert.alert("Cancel clock-in?", `This removes the ${job?.name ?? "job"} shift you just started — no time will be recorded. This can't be undone.`, [
      { text: "Keep It", style: "cancel" },
      {
        text: "Cancel Clock-In",
        style: "destructive",
        onPress: async () => {
          await deleteShift(shift.id);
          synchronize().catch(() => {});
          cancelStaleShiftReminder(shift.id).catch(() => {});
        },
      },
    ]);
  }

  async function handleClockOutAt(shift: Shift) {
    const date = await pick(new Date(), "Clock Out At");
    if (!date) return;
    if (date.getTime() <= new Date(shift.clockIn).getTime()) {
      Alert.alert("Invalid time", "Clock-out must be after clock-in.");
      return;
    }
    handleClockOut(shift, date);
  }

  async function handleStartBreak(shift: Shift, customTime?: Date) {
    if (customTime && customTime.getTime() < new Date(shift.clockIn).getTime()) {
      Alert.alert("Invalid time", "A break can't start before the shift's clock-in.");
      return;
    }
    await startBreak(shift.id, customTime?.toISOString());
    synchronize().catch(() => {});
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }

  async function handleStartBreakAt(shift: Shift) {
    const date = await pick(new Date(), "Start Break At");
    if (date) handleStartBreak(shift, date);
  }

  async function handleEndBreak(openBreak: Break, customTime?: Date) {
    if (customTime && customTime.getTime() <= new Date(openBreak.start).getTime()) {
      Alert.alert("Invalid time", "Break end must be after it started.");
      return;
    }
    await endBreak(openBreak.id, customTime?.toISOString());
    synchronize().catch(() => {});
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }

  async function handleEndBreakAt(openBreak: Break) {
    const date = await pick(new Date(), "End Break At");
    if (date) handleEndBreak(openBreak, date);
  }

  function weeklyProgressFor(job: Job | null): WeeklyProgress | null {
    if (!job) return null;
    const weekData = weekDataByJobId[job.id];
    if (!weekData) return null;
    return calculateWeeklyProgress({ job, shifts: weekData.shifts, breaksByShift: weekData.breaksByShift });
  }

  // Live pay for a still-open shift — reuses the exact same calculation History/
  // Timesheets/Export use for closed ones, just fed the shift's currently-elapsed hours
  // instead of a fixed final duration, so it counts up right alongside the timer.
  function payFor(shift: Shift, job: Job | null, worked: number): { cents: number; hasRate: boolean } | null {
    if (!job) return null;
    const jobTiers = allTiers.filter((t) => t.jobId === job.id);
    if (jobTiers.length === 0) return null;
    const [pay] = calculateShiftPay({
      job,
      tiers: jobTiers,
      versions: allVersions,
      shiftsWithHours: [{ shift, workedHours: worked / 3_600_000 }],
    });
    return pay ? { cents: pay.totalCents, hasRate: pay.rateCentsPerHour != null } : null;
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {openShiftDetails.map(({ shift, job, breaks, openBreak }) => {
        const worked = workedMillis(shift, breaks);
        const progress = weeklyProgressFor(job);
        const pay = payFor(shift, job, worked);
        return (
          <View key={shift.id} style={styles.openShiftCard}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => confirmCancelClockIn(shift, job)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={18} color={colors.textMuted2} />
            </TouchableOpacity>
            <View style={[styles.jobBadge, { backgroundColor: job?.colorHex ?? colors.primary }]}>
              <Text style={styles.jobBadgeText}>{job?.name ?? "Job"}</Text>
            </View>
            <Text style={styles.timer}>{formatDuration(worked)}</Text>
            {pay?.hasRate && <Text style={styles.earnings}>{formatCents(pay.cents)} so far</Text>}
            <Text style={styles.since}>Since {formatClock(shift.clockIn)}</Text>
            {openBreak && <Text style={styles.onBreak}>On break since {formatClock(openBreak.start)}</Text>}
            <TouchableOpacity
              style={styles.notesButton}
              onPress={() => setNotesEditor({ shiftId: shift.id, notes: shift.notes })}
            >
              <Ionicons name="create-outline" size={14} color={colors.primary} />
              <Text style={styles.notesButtonText} numberOfLines={1}>
                {shift.notes ? shift.notes : "Add note"}
              </Text>
            </TouchableOpacity>
            {progress && (
              <Text style={styles.weeklyProgress}>
                {progress.remainingMinutes > 0
                  ? `${formatDuration(progress.remainingMinutes * 60_000)} left this week`
                  : progress.overMinutes > 0
                    ? `Weekly target reached — ${formatDuration(progress.overMinutes * 60_000)} over`
                    : "Weekly target reached"}
                {progress.expectedClockOut && progress.remainingMinutes > 0
                  ? ` — expected out ${formatClock(progress.expectedClockOut.toISOString())}`
                  : ""}
              </Text>
            )}

            <View style={styles.splitRow}>
              <TouchableOpacity
                style={[styles.bigButton, openBreak ? styles.resumeButton : styles.breakButton, styles.flexButton]}
                onPress={() => (openBreak ? handleEndBreak(openBreak) : handleStartBreak(shift))}
              >
                <Text style={styles.bigButtonText}>{openBreak ? "End Break" : "Start Break"}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.atButton}
                onPress={() => (openBreak ? handleEndBreakAt(openBreak) : handleStartBreakAt(shift))}
              >
                <Text style={styles.atButtonText}>At...</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.splitRow}>
              <TouchableOpacity
                style={[styles.bigButton, styles.clockOutButton, styles.flexButton]}
                onPress={() => handleClockOut(shift)}
              >
                <Text style={styles.bigButtonText}>Clock Out</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.atButton} onPress={() => handleClockOutAt(shift)}>
                <Text style={styles.atButtonText}>At...</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}

      <View style={styles.newShiftSection}>
        <Text style={styles.label}>{openShiftDetails.length > 0 ? "Clock into another job" : "Select a job"}</Text>
        {availableJobs.length > 0 ? (
          <View style={styles.jobListBox}>
            <ScrollView style={styles.jobListScroll} nestedScrollEnabled contentContainerStyle={styles.jobListContent}>
              {availableJobs.map((job, index) => (
                <TouchableOpacity
                  key={job.id}
                  style={[
                    styles.jobRow,
                    index < availableJobs.length - 1 && styles.jobRowDivider,
                    selectedJobId === job.id && styles.jobRowSelected,
                  ]}
                  onPress={() => setSelectedJobId(job.id)}
                >
                  <View style={[styles.jobDot, { backgroundColor: job.colorHex }]} />
                  <Text style={[styles.jobRowText, selectedJobId === job.id && styles.jobRowTextSelected]} numberOfLines={1}>
                    {job.name}
                  </Text>
                  {selectedJobId === job.id && <Ionicons name="checkmark" size={18} color={colors.primary} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        ) : (
          <Text style={styles.empty}>{jobs.length === 0 ? "Add a job in the Jobs tab first." : "Already clocked into every job."}</Text>
        )}

        {tiers.length > 1 && (
          <>
            <Text style={styles.label}>Which rate?</Text>
            <View style={styles.jobPicker}>
              {tiers.map((tier) => (
                <TouchableOpacity
                  key={tier.id}
                  style={[styles.tierOption, selectedTierId === tier.id && styles.tierOptionSelected]}
                  onPress={() => setSelectedTierId(tier.id)}
                >
                  <Text style={[styles.jobOptionText, selectedTierId === tier.id && styles.jobOptionTextSelected]}>{tier.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {availableJobs.length > 0 && (
          <>
            {(() => {
              const selectedJob = jobs.find((j) => j.id === selectedJobId) ?? null;
              const progress = weeklyProgressFor(selectedJob);
              // Deliberately just the remaining-hours figure here, not expectedClockOut —
              // "expected clock-out" only means something once you're actually on the
              // clock; showing it before you've clocked in would read as a prediction
              // this screen has no basis for yet.
              if (!progress) return null;
              return (
                <Text style={styles.weeklyProgress}>
                  {progress.remainingMinutes > 0
                    ? `${formatDuration(progress.remainingMinutes * 60_000)} left this week`
                    : progress.overMinutes > 0
                      ? `Weekly target reached — ${formatDuration(progress.overMinutes * 60_000)} over`
                      : "Weekly target reached"}
                </Text>
              );
            })()}
            <View style={styles.splitRow}>
              <TouchableOpacity
                style={[styles.bigButton, styles.clockInButton, styles.flexButton]}
                onPress={() => handleClockIn()}
                disabled={!selectedJobId}
              >
                <Text style={styles.bigButtonText}>Clock In Now</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.atButton} onPress={handleClockInAt} disabled={!selectedJobId}>
                <Text style={styles.atButtonText}>Start At...</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      {modal}
      {notesEditor && (
        <ShiftNotesModal
          shiftId={notesEditor.shiftId}
          initialNotes={notesEditor.notes}
          onClose={() => setNotesEditor(null)}
        />
      )}
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flexGrow: 1, padding: 14, paddingTop: 16, backgroundColor: colors.card, gap: 12 },
    openShiftCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, alignItems: "center", position: "relative" },
    cancelButton: { position: "absolute", top: 10, right: 10, padding: 4, zIndex: 1 },
    label: { color: colors.textMuted3, fontSize: 13, marginBottom: 8, textAlign: "center" },
    jobBadge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16, marginBottom: 12 },
    jobBadgeText: { color: "#fff", fontWeight: "600", fontSize: 14 },
    timer: { fontSize: 32, fontWeight: "700", marginBottom: 4, fontVariant: ["tabular-nums"], color: colors.text },
    earnings: { fontSize: 15, fontWeight: "600", color: colors.success, marginBottom: 4 },
    since: { color: colors.textMuted2, marginBottom: 10, fontSize: 13 },
    onBreak: { color: colors.warning, fontWeight: "600", marginBottom: 8, fontSize: 13 },
    notesButton: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8, maxWidth: "100%" },
    notesButtonText: { color: colors.primary, fontSize: 12, fontWeight: "600", flexShrink: 1 },
    weeklyProgress: { color: colors.primary, fontSize: 12, marginBottom: 8, textAlign: "center" },
    newShiftSection: { alignItems: "center" },
    // A bounded, scrollable list rather than the old wrapping chip row — with a lot of
    // jobs, an unbounded wrap grid just kept growing and pushed everything else (open
    // shifts, the clock-in button) further down the screen. Capping the height here means
    // the rest of the screen's layout stays put regardless of how many jobs there are;
    // ScrollView still shrinks to fit when there are only a couple of jobs; it doesn't
    // force the full maxHeight.
    jobListBox: {
      width: "100%",
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      backgroundColor: colors.card,
      marginBottom: 14,
      overflow: "hidden",
    },
    jobListScroll: { maxHeight: 260 },
    jobListContent: { flexGrow: 1 },
    jobRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 11 },
    jobRowDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
    // A bit stronger than the shared colors.selectedBg (used for lighter-touch selection
    // elsewhere, like the header menu) — this one needs to stay legible at a glance in a
    // scrollable list of otherwise-identical rows, not just distinguishable on close look.
    jobRowSelected: { backgroundColor: colors.isDark ? "#2c4d78" : "#c7dbf7" },
    jobDot: { width: 12, height: 12, borderRadius: 6 },
    jobRowText: { flex: 1, fontWeight: "600", fontSize: 16, color: colors.text },
    jobRowTextSelected: { color: colors.primary },
    jobPicker: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", marginBottom: 14 },
    jobOption: { borderWidth: 2, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.card },
    jobOptionText: { fontWeight: "600", fontSize: 14, color: colors.text },
    jobOptionTextSelected: { color: "#fff" },
    tierOption: { borderWidth: 2, borderColor: colors.textMuted2, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
    tierOptionSelected: { backgroundColor: colors.invertBg, borderColor: colors.invertBg },
    bigButton: { borderRadius: 12, padding: 13, alignItems: "center" },
    bigButtonText: { color: "#fff", fontSize: 15, fontWeight: "700" },
    clockInButton: { backgroundColor: colors.successFill },
    clockOutButton: { backgroundColor: colors.dangerFill },
    breakButton: { backgroundColor: colors.warningFill },
    resumeButton: { backgroundColor: colors.primaryFill },
    splitRow: { flexDirection: "row", gap: 8, width: "100%", marginTop: 8 },
    flexButton: { flex: 1 },
    atButton: { borderRadius: 12, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.textMuted2, backgroundColor: colors.card },
    atButtonText: { color: colors.textSecondary, fontWeight: "700", fontSize: 13 },
    empty: { color: colors.textMuted2, fontSize: 13 },
  });
}
