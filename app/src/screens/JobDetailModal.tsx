import React, { useCallback, useState } from "react";
import { Alert, Modal, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import {
  addRateVersion,
  createRateTier,
  listRateTiers,
  listRateVersionsForTier,
  setRateTierArchived,
  updateJobDetails,
  updateJobOvertime,
} from "../db/database";
import { useDbRefresh } from "../lib/useDbRefresh";
import type { Job, RateTier, RateVersion } from "../types";

const PALETTE = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2"];

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

  const load = useCallback(() => {
    listRateTiers(job.id, true).then(setTiers);
  }, [job.id]);
  useDbRefresh(load);

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
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
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
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  title: { fontSize: 20, fontWeight: "700" },
  doneText: { color: "#2563eb", fontWeight: "600", fontSize: 16 },
  sectionLabel: { fontWeight: "600", color: "#444", marginTop: 16, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 10, backgroundColor: "#fff" },
  swatches: { flexDirection: "row", gap: 10 },
  swatch: { width: 28, height: 28, borderRadius: 14 },
  swatchSelected: { borderWidth: 3, borderColor: "#111" },
  tierRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#eee", gap: 8 },
  tierName: { fontWeight: "500" },
  tierRate: { color: "#666", fontSize: 13, marginTop: 2 },
  tierRateInput: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 8, width: 70 },
  tierAction: { paddingHorizontal: 6, paddingVertical: 4 },
  tierActionText: { color: "#2563eb", fontSize: 13, fontWeight: "600" },
  tierActionMuted: { color: "#999" },
  addTierRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  addTierInput: { flex: 2 },
  addTierRateInput: { flex: 1 },
  secondaryButton: { marginTop: 10, alignItems: "center", padding: 10, borderRadius: 8, borderWidth: 1, borderColor: "#2563eb" },
  secondaryButtonText: { color: "#2563eb", fontWeight: "600" },
  overtimeHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 20 },
  overtimeRow: { flexDirection: "row", gap: 12, marginTop: 8 },
  hint: { color: "#999", fontSize: 12, marginTop: 10, marginBottom: 30 },
});
