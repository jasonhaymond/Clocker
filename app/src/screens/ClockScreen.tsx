import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { clockIn, clockOut, endBreak, getJob, getOpenBreak, getOpenShift, listBreaksForShift, listJobs, startBreak } from "../db/database";
import { useDbRefresh } from "../lib/useDbRefresh";
import { formatDuration, workedMillis } from "../lib/time";
import { synchronize } from "../sync/sync";
import type { Break, Job, Shift } from "../types";

export function ClockScreen() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [openShift, setOpenShift] = useState<Shift | null>(null);
  const [openShiftJob, setOpenShiftJob] = useState<Job | null>(null);
  const [openBreak, setOpenBreak] = useState<Break | null>(null);
  const [breaks, setBreaks] = useState<Break[]>([]);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    listJobs(false).then(setJobs);
    getOpenShift().then(async (shift) => {
      setOpenShift(shift);
      if (shift) {
        const [job, shiftBreaks, brk] = await Promise.all([getJob(shift.jobId), listBreaksForShift(shift.id), getOpenBreak(shift.id)]);
        setOpenShiftJob(job);
        setBreaks(shiftBreaks);
        setOpenBreak(brk);
      } else {
        setOpenShiftJob(null);
        setBreaks([]);
        setOpenBreak(null);
      }
    });
  }, []);
  useDbRefresh(load);

  useEffect(() => {
    if (!selectedJobId && jobs.length > 0) setSelectedJobId(jobs[0].id);
  }, [jobs, selectedJobId]);

  // Re-render every 30s so the elapsed timer stays live while a shift or break is open.
  useEffect(() => {
    if (!openShift) return;
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, [openShift]);

  async function handleClockIn() {
    if (!selectedJobId) return;
    await clockIn(selectedJobId);
    synchronize().catch(() => {});
  }

  async function handleClockOut() {
    if (!openShift) return;
    await clockOut(openShift.id);
    synchronize().catch(() => {});
  }

  async function handleToggleBreak() {
    if (!openShift) return;
    if (openBreak) {
      await endBreak(openBreak.id);
    } else {
      await startBreak(openShift.id);
    }
    synchronize().catch(() => {});
  }

  if (openShift) {
    const worked = workedMillis(openShift, breaks);
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.label}>Currently clocked in</Text>
        <View style={[styles.jobBadge, { backgroundColor: openShiftJob?.colorHex ?? "#2563eb" }]}>
          <Text style={styles.jobBadgeText}>{openShiftJob?.name ?? "Job"}</Text>
        </View>
        <Text style={styles.timer}>{formatDuration(worked)}</Text>
        <Text style={styles.since}>Since {new Date(openShift.clockIn).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text>

        {openBreak && <Text style={styles.onBreak}>On break since {new Date(openBreak.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text>}

        <TouchableOpacity style={[styles.bigButton, openBreak ? styles.resumeButton : styles.breakButton]} onPress={handleToggleBreak}>
          <Text style={styles.bigButtonText}>{openBreak ? "End Break" : "Start Break"}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.bigButton, styles.clockOutButton]} onPress={handleClockOut}>
          <Text style={styles.bigButtonText}>Clock Out</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.label}>Select a job</Text>
      <View style={styles.jobPicker}>
        {jobs.map((job) => (
          <TouchableOpacity
            key={job.id}
            style={[styles.jobOption, { borderColor: job.colorHex }, selectedJobId === job.id && { backgroundColor: job.colorHex }]}
            onPress={() => setSelectedJobId(job.id)}
          >
            <Text style={[styles.jobOptionText, selectedJobId === job.id && styles.jobOptionTextSelected]}>{job.name}</Text>
          </TouchableOpacity>
        ))}
        {jobs.length === 0 && <Text style={styles.empty}>Add a job in the Jobs tab first.</Text>}
      </View>

      <TouchableOpacity style={[styles.bigButton, styles.clockInButton]} onPress={handleClockIn} disabled={!selectedJobId}>
        <Text style={styles.bigButtonText}>Clock In</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, alignItems: "center", padding: 24, paddingTop: 48, backgroundColor: "#fff" },
  label: { color: "#666", fontSize: 14, marginBottom: 12 },
  jobBadge: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginBottom: 24 },
  jobBadgeText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  timer: { fontSize: 48, fontWeight: "700", marginBottom: 8, fontVariant: ["tabular-nums"] },
  since: { color: "#999", marginBottom: 24 },
  onBreak: { color: "#d97706", fontWeight: "600", marginBottom: 16 },
  jobPicker: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center", marginBottom: 32 },
  jobOption: { borderWidth: 2, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 },
  jobOptionText: { fontWeight: "600" },
  jobOptionTextSelected: { color: "#fff" },
  bigButton: { width: "100%", borderRadius: 14, padding: 20, alignItems: "center", marginTop: 12 },
  bigButtonText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  clockInButton: { backgroundColor: "#16a34a" },
  clockOutButton: { backgroundColor: "#dc2626" },
  breakButton: { backgroundColor: "#d97706" },
  resumeButton: { backgroundColor: "#2563eb" },
  empty: { color: "#999" },
});
