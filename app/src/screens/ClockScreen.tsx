import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ShiftNotesModal } from "../components/ShiftNotesModal";
import {
  clockIn,
  clockOut,
  endBreak,
  getJob,
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
  const [openShiftDetails, setOpenShiftDetails] = useState<OpenShiftDetail[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [tiers, setTiers] = useState<RateTier[]>([]);
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [notesPrompt, setNotesPrompt] = useState<{ shiftId: string; notes: string | null } | null>(null);
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
  const availableJobs = jobs.filter((j) => !openJobIds.has(j.id));

  useEffect(() => {
    if (selectedJobId && availableJobs.some((j) => j.id === selectedJobId)) return;
    setSelectedJobId(availableJobs[0]?.id ?? null);
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
        clockInIso: shift.clockIn,
        workedMs: workedMillis(shift, breaks),
      })),
    ).catch(() => {});
  }, [openShiftDetails, tick]);

  async function handleClockIn(customTime?: Date) {
    if (!selectedJobId) return;
    const tierId = tiers.length > 1 ? selectedTierId : null;
    try {
      await clockIn(selectedJobId, tierId, customTime?.toISOString());
      synchronize().catch(() => {});
    } catch (e: any) {
      Alert.alert("Couldn't clock in", e?.message ?? "Unknown error");
    }
  }

  async function handleClockInAt() {
    const date = await pick(new Date(), "Clock In At");
    if (date) handleClockIn(date);
  }

  async function handleClockOut(shift: Shift, customTime?: Date) {
    await clockOut(shift.id, customTime?.toISOString());
    synchronize().catch(() => {});
    const job = jobs.find((j) => j.id === shift.jobId);
    if (job?.promptForNotesOnClockOut) setNotesPrompt({ shiftId: shift.id, notes: shift.notes });
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
            <View style={[styles.jobBadge, { backgroundColor: job?.colorHex ?? colors.primary }]}>
              <Text style={styles.jobBadgeText}>{job?.name ?? "Job"}</Text>
            </View>
            <Text style={styles.timer}>{formatDuration(worked)}</Text>
            {pay?.hasRate && <Text style={styles.earnings}>{formatCents(pay.cents)} so far</Text>}
            <Text style={styles.since}>Since {formatClock(shift.clockIn)}</Text>
            {openBreak && <Text style={styles.onBreak}>On break since {formatClock(openBreak.start)}</Text>}
            {progress && (
              <Text style={styles.weeklyProgress}>
                {progress.remainingMinutes > 0
                  ? `${formatDuration(progress.remainingMinutes * 60_000)} left this week`
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
        <View style={styles.jobPicker}>
          {availableJobs.map((job) => (
            <TouchableOpacity
              key={job.id}
              style={[styles.jobOption, { borderColor: job.colorHex }, selectedJobId === job.id && { backgroundColor: job.colorHex }]}
              onPress={() => setSelectedJobId(job.id)}
            >
              <Text style={[styles.jobOptionText, selectedJobId === job.id && styles.jobOptionTextSelected]}>{job.name}</Text>
            </TouchableOpacity>
          ))}
          {jobs.length === 0 && <Text style={styles.empty}>Add a job in the Jobs tab first.</Text>}
          {jobs.length > 0 && availableJobs.length === 0 && <Text style={styles.empty}>Already clocked into every job.</Text>}
        </View>

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
      {notesPrompt && (
        <ShiftNotesModal
          shiftId={notesPrompt.shiftId}
          initialNotes={notesPrompt.notes}
          onClose={() => setNotesPrompt(null)}
        />
      )}
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flexGrow: 1, padding: 14, paddingTop: 16, backgroundColor: colors.card, gap: 12 },
    openShiftCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, alignItems: "center" },
    label: { color: colors.textMuted3, fontSize: 13, marginBottom: 8, textAlign: "center" },
    jobBadge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16, marginBottom: 12 },
    jobBadgeText: { color: "#fff", fontWeight: "600", fontSize: 14 },
    timer: { fontSize: 32, fontWeight: "700", marginBottom: 4, fontVariant: ["tabular-nums"], color: colors.text },
    earnings: { fontSize: 15, fontWeight: "600", color: colors.success, marginBottom: 4 },
    since: { color: colors.textMuted2, marginBottom: 10, fontSize: 13 },
    onBreak: { color: colors.warning, fontWeight: "600", marginBottom: 8, fontSize: 13 },
    weeklyProgress: { color: colors.primary, fontSize: 12, marginBottom: 8, textAlign: "center" },
    newShiftSection: { alignItems: "center" },
    jobPicker: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", marginBottom: 14 },
    jobOption: { borderWidth: 2, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.card },
    jobOptionText: { fontWeight: "600", fontSize: 14, color: colors.text },
    jobOptionTextSelected: { color: "#fff" },
    tierOption: { borderWidth: 2, borderColor: colors.textMuted2, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
    tierOptionSelected: { backgroundColor: colors.invertBg, borderColor: colors.invertBg },
    bigButton: { borderRadius: 12, padding: 13, alignItems: "center" },
    bigButtonText: { color: "#fff", fontSize: 15, fontWeight: "700" },
    clockInButton: { backgroundColor: colors.success },
    clockOutButton: { backgroundColor: colors.danger },
    breakButton: { backgroundColor: colors.warning },
    resumeButton: { backgroundColor: colors.primary },
    splitRow: { flexDirection: "row", gap: 8, width: "100%", marginTop: 8 },
    flexButton: { flex: 1 },
    atButton: { borderRadius: 12, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.textMuted2, backgroundColor: colors.card },
    atButtonText: { color: colors.textSecondary, fontWeight: "700", fontSize: 13 },
    empty: { color: colors.textMuted2, fontSize: 13 },
  });
}
