import React, { useCallback, useEffect, useState } from "react";
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
  listJobs,
  listRateTiers,
  startBreak,
} from "../db/database";
import { getPromptForNotesOnClockOut } from "../lib/preferences";
import { useDbRefresh } from "../lib/useDbRefresh";
import { useDateTimePicker } from "../lib/useDateTimePicker";
import { synchronize } from "../sync/sync";
import { formatClock, formatDuration, workedMillis, type Break, type Job, type RateTier, type Shift } from "@clocker/shared";

interface OpenShiftDetail {
  shift: Shift;
  job: Job | null;
  breaks: Break[];
  openBreak: Break | null;
}

export function ClockScreen() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [openShiftDetails, setOpenShiftDetails] = useState<OpenShiftDetail[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [tiers, setTiers] = useState<RateTier[]>([]);
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [promptForNotes, setPromptForNotes] = useState(false);
  const [notesPrompt, setNotesPrompt] = useState<{ shiftId: string; notes: string | null } | null>(null);
  const { pick, modal } = useDateTimePicker();

  useEffect(() => {
    getPromptForNotesOnClockOut().then(setPromptForNotes);
  }, []);

  const load = useCallback(() => {
    listJobs(false).then(setJobs);
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
    if (promptForNotes) setNotesPrompt({ shiftId: shift.id, notes: shift.notes });
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

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {openShiftDetails.map(({ shift, job, breaks, openBreak }) => {
        const worked = workedMillis(shift, breaks);
        return (
          <View key={shift.id} style={styles.openShiftCard}>
            <View style={[styles.jobBadge, { backgroundColor: job?.colorHex ?? "#2563eb" }]}>
              <Text style={styles.jobBadgeText}>{job?.name ?? "Job"}</Text>
            </View>
            <Text style={styles.timer}>{formatDuration(worked)}</Text>
            <Text style={styles.since}>Since {formatClock(shift.clockIn)}</Text>
            {openBreak && <Text style={styles.onBreak}>On break since {formatClock(openBreak.start)}</Text>}

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
          <View style={styles.splitRow}>
            <TouchableOpacity
              style={[styles.bigButton, styles.clockInButton, styles.flexButton]}
              onPress={() => handleClockIn()}
              disabled={!selectedJobId}
            >
              <Text style={styles.bigButtonText}>Clock In</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.atButton} onPress={handleClockInAt} disabled={!selectedJobId}>
              <Text style={styles.atButtonText}>At...</Text>
            </TouchableOpacity>
          </View>
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

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 14, paddingTop: 16, backgroundColor: "#fff", gap: 12 },
  openShiftCard: { backgroundColor: "#f4f5f7", borderRadius: 12, padding: 14, alignItems: "center" },
  label: { color: "#666", fontSize: 13, marginBottom: 8, textAlign: "center" },
  jobBadge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16, marginBottom: 12 },
  jobBadgeText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  timer: { fontSize: 32, fontWeight: "700", marginBottom: 4, fontVariant: ["tabular-nums"] },
  since: { color: "#999", marginBottom: 10, fontSize: 13 },
  onBreak: { color: "#d97706", fontWeight: "600", marginBottom: 8, fontSize: 13 },
  newShiftSection: { alignItems: "center" },
  jobPicker: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", marginBottom: 14 },
  jobOption: { borderWidth: 2, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  jobOptionText: { fontWeight: "600", fontSize: 14 },
  jobOptionTextSelected: { color: "#fff" },
  tierOption: { borderWidth: 2, borderColor: "#999", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  tierOptionSelected: { backgroundColor: "#111", borderColor: "#111" },
  bigButton: { borderRadius: 12, padding: 13, alignItems: "center" },
  bigButtonText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  clockInButton: { backgroundColor: "#16a34a" },
  clockOutButton: { backgroundColor: "#dc2626" },
  breakButton: { backgroundColor: "#d97706" },
  resumeButton: { backgroundColor: "#2563eb" },
  splitRow: { flexDirection: "row", gap: 8, width: "100%", marginTop: 8 },
  flexButton: { flex: 1 },
  atButton: { borderRadius: 12, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#999" },
  atButtonText: { color: "#333", fontWeight: "700", fontSize: 13 },
  empty: { color: "#999", fontSize: 13 },
});
