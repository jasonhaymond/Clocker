import React, { useCallback, useState } from "react";
import { Alert, Modal, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import {
  addJobManager,
  addRateVersion,
  createManager,
  createRateTier,
  deleteManager,
  listJobManagers,
  listManagers,
  listRateTiers,
  listRateVersionsForTier,
  removeJobManager,
  setManagerArchived,
  setRateTierArchived,
  updateJobDetails,
  updateJobOvertime,
  updateJobRounding,
  updateJobTimesheetSettings,
} from "../db/database";
import { ROUNDING_INCREMENT_MINUTES } from "../lib/rounding";
import type { PeriodType } from "../lib/timesheetPeriods";
import { useDateTimePicker } from "../lib/useDateTimePicker";
import { useDbRefresh } from "../lib/useDbRefresh";
import type { Job, JobManager, Manager, RateTier, RateVersion, RoundingMode, TimesheetExportFormat } from "../types";

const PALETTE = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2"];

const PERIOD_TYPES: { key: PeriodType; label: string }[] = [
  { key: "weekly", label: "Weekly" },
  { key: "biweekly", label: "Biweekly" },
  { key: "monthly", label: "Monthly" },
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FORMATS: { key: TimesheetExportFormat; label: string }[] = [
  { key: "csv", label: "CSV" },
  { key: "text", label: "Formatted text" },
  { key: "both", label: "Both" },
];
const ROUNDING_MODES: { key: RoundingMode; label: string }[] = [
  { key: "nearest", label: "Nearest" },
  { key: "up", label: "Up" },
  { key: "down", label: "Down" },
];
function incrementLabel(minutes: number): string {
  return minutes >= 60 ? `${minutes / 60}hr` : `${minutes}min`;
}

function currentRate(versions: RateVersion[]): RateVersion | null {
  const now = Date.now();
  let best: RateVersion | null = null;
  for (const v of versions) {
    const effective = new Date(v.effectiveFrom).getTime();
    if (effective > now) continue;
    if (!best || effective > new Date(best.effectiveFrom).getTime()) best = v;
  }
  return best;
}

function TierRow({ tier }: { tier: RateTier }) {
  const [versions, setVersions] = useState<RateVersion[]>([]);
  const [newRate, setNewRate] = useState("");
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    listRateVersionsForTier(tier.id).then(setVersions);
  }, [tier.id]);
  useDbRefresh(load);

  const active = currentRate(versions);

  async function saveRate() {
    const cents = Math.round(parseFloat(newRate) * 100);
    if (!Number.isFinite(cents) || cents < 0) return;
    await addRateVersion(tier.id, cents);
    setNewRate("");
    setEditing(false);
  }

  return (
    <View style={styles.tierRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.tierName}>
          {tier.name}
          {tier.isDefault ? " (default)" : ""}
        </Text>
        <Text style={styles.tierRate}>{active ? `$${(active.hourlyRateCents / 100).toFixed(2)}/hr` : "No rate set"}</Text>
      </View>
      {editing ? (
        <>
          <TextInput
            style={styles.tierRateInput}
            placeholder="0.00"
            keyboardType="decimal-pad"
            value={newRate}
            onChangeText={setNewRate}
            autoFocus
          />
          <TouchableOpacity onPress={saveRate} style={styles.tierAction}>
            <Text style={styles.tierActionText}>Save</Text>
          </TouchableOpacity>
        </>
      ) : (
        <TouchableOpacity onPress={() => setEditing(true)} style={styles.tierAction}>
          <Text style={styles.tierActionText}>Change rate</Text>
        </TouchableOpacity>
      )}
      {!tier.isDefault && (
        <TouchableOpacity onPress={() => setRateTierArchived(tier.id, !tier.archived)} style={styles.tierAction}>
          <Text style={[styles.tierActionText, tier.archived && styles.tierActionMuted]}>
            {tier.archived ? "Unarchive" : "Archive"}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// Manager checkboxes for "submit this job's timesheets to". Managers themselves are a
// global address book (shared across jobs); this section only manages which of them are
// assigned to *this* job, via the JobManager join rows.
function ManagerAssignment({ jobId }: { jobId: string }) {
  const [managers, setManagers] = useState<Manager[]>([]);
  const [assignments, setAssignments] = useState<JobManager[]>([]);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");

  const load = useCallback(() => {
    listManagers(true).then(setManagers);
    listJobManagers(jobId).then(setAssignments);
  }, [jobId]);
  useDbRefresh(load);

  const assignmentByManagerId = new Map(assignments.map((a) => [a.managerId, a]));

  async function toggle(managerId: string) {
    const existing = assignmentByManagerId.get(managerId);
    if (existing) await removeJobManager(existing.id);
    else await addJobManager(jobId, managerId);
  }

  async function addManager() {
    if (!newName.trim() || !newEmail.trim()) return;
    const manager = await createManager({ name: newName.trim(), email: newEmail.trim() });
    await addJobManager(jobId, manager.id);
    setNewName("");
    setNewEmail("");
  }

  function confirmDelete(manager: Manager) {
    Alert.alert("Remove recipient", `Remove "${manager.name}" everywhere (not just this job)?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => deleteManager(manager.id) },
    ]);
  }

  return (
    <>
      {managers.length === 0 && <Text style={styles.hint}>No managers yet — add one below.</Text>}
      {managers.map((m) => {
        const assigned = assignmentByManagerId.has(m.id);
        return (
          <View key={m.id} style={styles.managerRow}>
            <TouchableOpacity style={styles.checkbox} onPress={() => toggle(m.id)}>
              <View style={[styles.checkboxBox, assigned && styles.checkboxBoxChecked]}>
                {assigned && <Text style={styles.checkmark}>✓</Text>}
              </View>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={[styles.managerName, m.archived && styles.archivedText]}>{m.name}</Text>
              <Text style={styles.tierRate}>{m.email}</Text>
            </View>
            <TouchableOpacity onPress={() => setManagerArchived(m.id, !m.archived)} style={styles.tierAction}>
              <Text style={styles.tierActionText}>{m.archived ? "Unarchive" : "Archive"}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => confirmDelete(m)} style={styles.tierAction}>
              <Text style={[styles.tierActionText, styles.tierActionMuted]}>Remove</Text>
            </TouchableOpacity>
          </View>
        );
      })}
      <View style={styles.addTierRow}>
        <TextInput style={[styles.input, styles.addTierInput]} placeholder="Name" value={newName} onChangeText={setNewName} />
        <TextInput
          style={[styles.input, styles.addTierInput]}
          placeholder="Email"
          autoCapitalize="none"
          keyboardType="email-address"
          value={newEmail}
          onChangeText={setNewEmail}
        />
      </View>
      <TouchableOpacity style={styles.secondaryButton} onPress={addManager}>
        <Text style={styles.secondaryButtonText}>+ Add Manager</Text>
      </TouchableOpacity>
    </>
  );
}

export function JobDetailModal({ job, onClose }: { job: Job; onClose: () => void }) {
  const [name, setName] = useState(job.name);
  const [color, setColor] = useState(job.colorHex);
  const [tiers, setTiers] = useState<RateTier[]>([]);
  const [newTierName, setNewTierName] = useState("");
  const [newTierRate, setNewTierRate] = useState("");
  const [overtimeEnabled, setOvertimeEnabled] = useState(job.overtimeMultiplier != null);
  const [multiplier, setMultiplier] = useState(job.overtimeMultiplier != null ? String(job.overtimeMultiplier) : "1.5");
  const [threshold, setThreshold] = useState(
    job.overtimeWeeklyThresholdHours != null ? String(job.overtimeWeeklyThresholdHours) : "40",
  );
  const [rounding, setRounding] = useState({
    enabled: job.roundingEnabled,
    mode: job.roundingMode,
    incrementMinutes: job.roundingIncrementMinutes,
  });
  const [timesheet, setTimesheet] = useState({
    periodType: job.timesheetPeriodType,
    weekStartDay: job.timesheetWeekStartDay,
    biweeklyAnchor: job.timesheetBiweeklyAnchor,
    monthlyStartDay: job.timesheetMonthlyStartDay,
    format: job.timesheetFormat,
    includeEarnings: job.timesheetIncludeEarnings,
    includeNotes: job.timesheetIncludeNotes,
    includeTimes: job.timesheetIncludeTimes,
  });
  const { pick, modal: anchorModal } = useDateTimePicker();

  const load = useCallback(() => {
    listRateTiers(job.id, true).then(setTiers);
  }, [job.id]);
  useDbRefresh(load);

  async function saveRounding(next: typeof rounding) {
    setRounding(next);
    await updateJobRounding(job.id, { roundingEnabled: next.enabled, roundingMode: next.mode, roundingIncrementMinutes: next.incrementMinutes });
  }

  async function saveTimesheet(next: typeof timesheet) {
    setTimesheet(next);
    await updateJobTimesheetSettings(job.id, {
      timesheetPeriodType: next.periodType,
      timesheetWeekStartDay: next.weekStartDay,
      timesheetBiweeklyAnchor: next.biweeklyAnchor,
      timesheetMonthlyStartDay: next.monthlyStartDay,
      timesheetFormat: next.format,
      timesheetIncludeEarnings: next.includeEarnings,
      timesheetIncludeNotes: next.includeNotes,
      timesheetIncludeTimes: next.includeTimes,
    });
  }

  async function pickAnchor() {
    const date = await pick(new Date(timesheet.biweeklyAnchor), "First day of a current period");
    if (date) saveTimesheet({ ...timesheet, biweeklyAnchor: date.toISOString() });
  }

  async function saveName() {
    if (name.trim() && name.trim() !== job.name) await updateJobDetails(job.id, { name: name.trim() });
  }

  async function saveColor(c: string) {
    setColor(c);
    await updateJobDetails(job.id, { colorHex: c });
  }

  async function addTier() {
    if (!newTierName.trim()) return;
    const cents = newTierRate.trim() ? Math.round(parseFloat(newTierRate) * 100) : null;
    await createRateTier(job.id, newTierName.trim(), cents, false);
    setNewTierName("");
    setNewTierRate("");
  }

  async function saveOvertime(enabled: boolean, mult: string, thresh: string) {
    if (!enabled) {
      await updateJobOvertime(job.id, { overtimeMultiplier: null, overtimeWeeklyThresholdHours: null });
      return;
    }
    const multValue = parseFloat(mult);
    const threshValue = parseFloat(thresh);
    if (!Number.isFinite(multValue) || !Number.isFinite(threshValue)) return;
    await updateJobOvertime(job.id, { overtimeMultiplier: multValue, overtimeWeeklyThresholdHours: threshValue });
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 14 }}>
        <View style={styles.header}>
          <Text style={styles.title}>Edit Job</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.doneText}>Done</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>Name</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} onBlur={saveName} />

        <Text style={styles.sectionLabel}>Color</Text>
        <View style={styles.swatches}>
          {PALETTE.map((c) => (
            <TouchableOpacity
              key={c}
              style={[styles.swatch, { backgroundColor: c }, c === color && styles.swatchSelected]}
              onPress={() => saveColor(c)}
            />
          ))}
        </View>

        <Text style={styles.sectionLabel}>Rates</Text>
        {tiers.map((tier) => (
          <TierRow key={tier.id} tier={tier} />
        ))}
        <View style={styles.addTierRow}>
          <TextInput
            style={[styles.input, styles.addTierInput]}
            placeholder="New rate name (e.g. Holiday)"
            value={newTierName}
            onChangeText={setNewTierName}
          />
          <TextInput
            style={[styles.input, styles.addTierRateInput]}
            placeholder="$/hr"
            keyboardType="decimal-pad"
            value={newTierRate}
            onChangeText={setNewTierRate}
          />
        </View>
        <TouchableOpacity style={styles.secondaryButton} onPress={addTier}>
          <Text style={styles.secondaryButtonText}>+ Add Rate Tier</Text>
        </TouchableOpacity>

        <View style={styles.overtimeHeader}>
          <Text style={styles.sectionLabel}>Weekly overtime</Text>
          <Switch
            value={overtimeEnabled}
            onValueChange={(v) => {
              setOvertimeEnabled(v);
              saveOvertime(v, multiplier, threshold);
            }}
          />
        </View>
        {overtimeEnabled && (
          <View style={styles.overtimeRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.tierRate}>Threshold (hrs/week)</Text>
              <TextInput
                style={styles.input}
                keyboardType="decimal-pad"
                value={threshold}
                onChangeText={setThreshold}
                onBlur={() => saveOvertime(overtimeEnabled, multiplier, threshold)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.tierRate}>Multiplier</Text>
              <TextInput
                style={styles.input}
                keyboardType="decimal-pad"
                value={multiplier}
                onChangeText={setMultiplier}
                onBlur={() => saveOvertime(overtimeEnabled, multiplier, threshold)}
              />
            </View>
          </View>
        )}
        <Text style={styles.hint}>
          Hours worked on this job beyond the threshold in a given week are paid at rate × multiplier.
        </Text>

        <View style={styles.overtimeHeader}>
          <Text style={styles.sectionLabel}>Round time entries</Text>
          <Switch value={rounding.enabled} onValueChange={(v) => saveRounding({ ...rounding, enabled: v })} />
        </View>
        {rounding.enabled && (
          <>
            <Text style={styles.hint}>Round to nearest</Text>
            <View style={styles.chipRow}>
              {ROUNDING_INCREMENT_MINUTES.map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.chip, rounding.incrementMinutes === m && styles.chipSelected]}
                  onPress={() => saveRounding({ ...rounding, incrementMinutes: m })}
                >
                  <Text style={[styles.chipText, rounding.incrementMinutes === m && styles.chipTextSelected]}>{incrementLabel(m)}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.hint}>Direction</Text>
            <View style={styles.chipRow}>
              {ROUNDING_MODES.map((m) => (
                <TouchableOpacity
                  key={m.key}
                  style={[styles.chip, rounding.mode === m.key && styles.chipSelected]}
                  onPress={() => saveRounding({ ...rounding, mode: m.key })}
                >
                  <Text style={[styles.chipText, rounding.mode === m.key && styles.chipTextSelected]}>{m.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
        <Text style={styles.hint}>
          Rounds each clock-in/out to the nearest increment before computing hours and pay, like a physical
          timeclock. The actual punch times you recorded are never changed.
        </Text>

        <Text style={styles.sectionLabel}>Timesheet period</Text>
        <View style={styles.chipRow}>
          {PERIOD_TYPES.map((p) => (
            <TouchableOpacity
              key={p.key}
              style={[styles.chip, timesheet.periodType === p.key && styles.chipSelected]}
              onPress={() => saveTimesheet({ ...timesheet, periodType: p.key })}
            >
              <Text style={[styles.chipText, timesheet.periodType === p.key && styles.chipTextSelected]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {(timesheet.periodType === "weekly" || timesheet.periodType === "biweekly") && (
          <>
            <Text style={styles.hint}>Period starts on</Text>
            <View style={styles.chipRow}>
              {WEEKDAYS.map((d, i) => (
                <TouchableOpacity
                  key={d}
                  style={[styles.dayChip, timesheet.weekStartDay === i && styles.chipSelected]}
                  onPress={() => saveTimesheet({ ...timesheet, weekStartDay: i })}
                >
                  <Text style={[styles.chipText, timesheet.weekStartDay === i && styles.chipTextSelected]}>{d}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
        {timesheet.periodType === "biweekly" && (
          <>
            <Text style={styles.hint}>First day of a current period (fixes which week pairs with which)</Text>
            <TouchableOpacity style={styles.input} onPress={pickAnchor}>
              <Text>{new Date(timesheet.biweeklyAnchor).toLocaleDateString()}</Text>
            </TouchableOpacity>
          </>
        )}
        {timesheet.periodType === "monthly" && (
          <>
            <Text style={styles.hint}>Day of month period starts (1-28)</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={String(timesheet.monthlyStartDay)}
              onChangeText={(v) => {
                const n = Math.max(1, Math.min(28, parseInt(v, 10) || 1));
                saveTimesheet({ ...timesheet, monthlyStartDay: n });
              }}
            />
          </>
        )}

        <Text style={styles.sectionLabel}>Include in timesheet</Text>
        <View style={styles.overtimeHeader}>
          <Text style={styles.tierRate}>Earnings</Text>
          <Switch value={timesheet.includeEarnings} onValueChange={(v) => saveTimesheet({ ...timesheet, includeEarnings: v })} />
        </View>
        <View style={styles.overtimeHeader}>
          <Text style={styles.tierRate}>Notes</Text>
          <Switch value={timesheet.includeNotes} onValueChange={(v) => saveTimesheet({ ...timesheet, includeNotes: v })} />
        </View>
        <View style={styles.overtimeHeader}>
          <Text style={styles.tierRate}>Start/end times</Text>
          <Switch value={timesheet.includeTimes} onValueChange={(v) => saveTimesheet({ ...timesheet, includeTimes: v })} />
        </View>

        <Text style={styles.sectionLabel}>Submission format</Text>
        <View style={styles.chipRow}>
          {FORMATS.map((f) => (
            <TouchableOpacity
              key={f.key}
              style={[styles.chip, timesheet.format === f.key && styles.chipSelected]}
              onPress={() => saveTimesheet({ ...timesheet, format: f.key })}
            >
              <Text style={[styles.chipText, timesheet.format === f.key && styles.chipTextSelected]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Submit to</Text>
        <ManagerAssignment jobId={job.id} />

        {anchorModal}
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  title: { fontSize: 17, fontWeight: "700" },
  doneText: { color: "#2563eb", fontWeight: "600", fontSize: 15 },
  sectionLabel: { fontWeight: "600", color: "#444", marginTop: 12, marginBottom: 6, fontSize: 13 },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 8, backgroundColor: "#fff" },
  swatches: { flexDirection: "row", gap: 8 },
  swatch: { width: 24, height: 24, borderRadius: 12 },
  swatchSelected: { borderWidth: 3, borderColor: "#111" },
  tierRow: { flexDirection: "row", alignItems: "center", paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: "#eee", gap: 8 },
  tierName: { fontWeight: "500", fontSize: 14 },
  tierRate: { color: "#666", fontSize: 12, marginTop: 1 },
  tierRateInput: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 6, width: 64 },
  tierAction: { paddingHorizontal: 5, paddingVertical: 3 },
  tierActionText: { color: "#2563eb", fontSize: 12, fontWeight: "600" },
  tierActionMuted: { color: "#999" },
  addTierRow: { flexDirection: "row", gap: 6, marginTop: 8 },
  addTierInput: { flex: 2 },
  addTierRateInput: { flex: 1 },
  secondaryButton: { marginTop: 8, alignItems: "center", padding: 8, borderRadius: 8, borderWidth: 1, borderColor: "#2563eb" },
  secondaryButtonText: { color: "#2563eb", fontWeight: "600", fontSize: 13 },
  overtimeHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 14 },
  overtimeRow: { flexDirection: "row", gap: 10, marginTop: 6 },
  hint: { color: "#999", fontSize: 11, marginTop: 8, marginBottom: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderColor: "#ddd", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6 },
  dayChip: { borderWidth: 1, borderColor: "#ddd", borderRadius: 14, paddingHorizontal: 8, paddingVertical: 6 },
  chipSelected: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  chipText: { color: "#333", fontSize: 13 },
  chipTextSelected: { color: "#fff", fontWeight: "600" },
  managerRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#eee", gap: 6 },
  checkbox: { padding: 4 },
  checkboxBox: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: "#999", alignItems: "center", justifyContent: "center" },
  checkboxBoxChecked: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  checkmark: { color: "#fff", fontSize: 13, fontWeight: "700" },
  managerName: { fontSize: 14, fontWeight: "500" },
  archivedText: { color: "#999", textDecorationLine: "line-through" },
});
