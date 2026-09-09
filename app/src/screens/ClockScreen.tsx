import React, { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
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
import { useDbRefresh } from "../lib/useDbRefresh";
import { formatClock, formatDuration, workedMillis } from "../lib/time";
import { useDateTimePicker } from "../lib/useDateTimePicker";
import { synchronize } from "../sync/sync";
import type { Break, Job, RateTier, Shift } from "../types";

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
  const { pick, modal } = useDateTimePicker();

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

  async function handleClockOut(shiftId: string, customTime?: Date) {
    await clockOut(shiftId, customTime?.toISOString());
    synchronize().catch(() => {});
  }

  async function handleClockOutAt(shift: Shift) {
    const date = await pick(new Date(), "Clock Out At");
    if (!date) return;
    if (date.getTime() <= new Date(shift.clockIn).getTime()) {
      Alert.alert("Invalid time", "Clock-out must be after clock-in.");
      return;
    }
    handleClockOut(shift.id, date);
  }

  async function handleToggleBreak(shift: Shift, openBreak: Break | null) {
    if (openBreak) {
      await endBreak(openBreak.id);
    } else {
      await startBreak(shift.id);
    }
    synchronize().catch(() => {});
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

            <TouchableOpacity
              style={[styles.bigButton, openBreak ? styles.resumeButton : styles.breakButton]}
              onPress={() => handleToggleBreak(shift, openBreak)}
            >
              <Text style={styles.bigButtonText}>{openBreak ? "End Break" : "Start Break"}</Text>
            </TouchableOpacity>

            <View style={styles.splitRow}>
              <TouchableOpacity
                style={[styles.bigButton, styles.clockOutButton, styles.flexButton]}
                onPress={() => handleClockOut(shift.id)}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 20, paddingTop: 24, backgroundColor: "#fff", gap: 20 },
  openShiftCard: { backgroundColor: "#f4f5f7", borderRadius: 16, padding: 20, alignItems: "center" },
  label: { color: "#666", fontSize: 14, marginBottom: 12, textAlign: "center" },
  jobBadge: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginBottom: 20 },
  jobBadgeText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  timer: { fontSize: 40, fontWeight: "700", marginBottom: 6, fontVariant: ["tabular-nums"] },
  since: { color: "#999", marginBottom: 16 },
  onBreak: { color: "#d97706", fontWeight: "600", marginBottom: 12 },
  newShiftSection: { alignItems: "center" },
  jobPicker: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center", marginBottom: 24 },
  jobOption: { borderWidth: 2, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 },
  jobOptionText: { fontWeight: "600" },
  jobOptionTextSelected: { color: "#fff" },
  tierOption: { borderWidth: 2, borderColor: "#999", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 },
  tierOptionSelected: { backgroundColor: "#111", borderColor: "#111" },
  bigButton: { borderRadius: 14, padding: 18, alignItems: "center" },
  bigButtonText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  clockInButton: { backgroundColor: "#16a34a" },
  clockOutButton: { backgroundColor: "#dc2626" },
  breakButton: { backgroundColor: "#d97706" },
  resumeButton: { backgroundColor: "#2563eb" },
  splitRow: { flexDirection: "row", gap: 10, width: "100%", marginTop: 12 },
  flexButton: { flex: 1 },
  atButton: { borderRadius: 14, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#999" },
  atButtonText: { color: "#333", fontWeight: "700" },
  empty: { color: "#999" },
});
