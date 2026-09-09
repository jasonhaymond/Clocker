import React, { useCallback, useState } from "react";
import { Alert, Modal, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { createManager, deleteManager, listManagers, setManagerArchived } from "../db/database";
import type { TimesheetExportFormat, TimesheetSettings } from "../lib/preferences";
import { useDateTimePicker } from "../lib/useDateTimePicker";
import { useDbRefresh } from "../lib/useDbRefresh";
import type { PeriodType } from "../lib/timesheetPeriods";
import type { Manager } from "../types";

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

function ManagerRow({ manager, selected, onToggle }: { manager: Manager; selected: boolean; onToggle: () => void }) {
  function confirmDelete() {
    Alert.alert("Remove recipient", `Remove "${manager.name}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => deleteManager(manager.id) },
    ]);
  }

  return (
    <View style={styles.managerRow}>
      <TouchableOpacity style={styles.checkbox} onPress={onToggle}>
        <View style={[styles.checkboxBox, selected && styles.checkboxBoxChecked]}>{selected && <Text style={styles.checkmark}>✓</Text>}</View>
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={[styles.managerName, manager.archived && styles.archivedText]}>{manager.name}</Text>
        <Text style={styles.managerEmail}>{manager.email}</Text>
      </View>
      <TouchableOpacity onPress={() => setManagerArchived(manager.id, !manager.archived)} style={styles.rowAction}>
        <Text style={styles.rowActionText}>{manager.archived ? "Unarchive" : "Archive"}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={confirmDelete} style={styles.rowAction}>
        <Text style={[styles.rowActionText, styles.deleteText]}>Remove</Text>
      </TouchableOpacity>
    </View>
  );
}

export function TimesheetSettingsModal({
  settings,
  onChange,
  onClose,
}: {
  settings: TimesheetSettings;
  onChange: (next: TimesheetSettings) => void;
  onClose: () => void;
}) {
  const [managers, setManagers] = useState<Manager[]>([]);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const { pick, modal } = useDateTimePicker();

  const load = useCallback(() => {
    listManagers(true).then(setManagers);
  }, []);
  useDbRefresh(load);

  function patch(fields: Partial<TimesheetSettings>) {
    onChange({ ...settings, ...fields });
  }

  function toggleManager(id: string) {
    const set = new Set(settings.managerIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    patch({ managerIds: Array.from(set) });
  }

  async function addManager() {
    if (!newName.trim() || !newEmail.trim()) return;
    const manager = await createManager({ name: newName.trim(), email: newEmail.trim() });
    patch({ managerIds: [...settings.managerIds, manager.id] });
    setNewName("");
    setNewEmail("");
  }

  async function pickAnchor() {
    const date = await pick(new Date(settings.biweeklyAnchor), "First day of a current period");
    if (date) patch({ biweeklyAnchor: date.toISOString() });
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
        <View style={styles.header}>
          <Text style={styles.title}>Timesheet Settings</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.doneText}>Done</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>Period</Text>
        <View style={styles.chipRow}>
          {PERIOD_TYPES.map((p) => (
            <TouchableOpacity
              key={p.key}
              style={[styles.chip, settings.periodType === p.key && styles.chipSelected]}
              onPress={() => patch({ periodType: p.key })}
            >
              <Text style={[styles.chipText, settings.periodType === p.key && styles.chipTextSelected]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {(settings.periodType === "weekly" || settings.periodType === "biweekly") && (
          <>
            <Text style={styles.hint}>Period starts on</Text>
            <View style={styles.chipRow}>
              {WEEKDAYS.map((d, i) => (
                <TouchableOpacity
                  key={d}
                  style={[styles.dayChip, settings.weekStartDay === i && styles.chipSelected]}
                  onPress={() => patch({ weekStartDay: i })}
                >
                  <Text style={[styles.chipText, settings.weekStartDay === i && styles.chipTextSelected]}>{d}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {settings.periodType === "biweekly" && (
          <>
            <Text style={styles.hint}>First day of a current period (fixes which week pairs with which)</Text>
            <TouchableOpacity style={styles.input} onPress={pickAnchor}>
              <Text>{new Date(settings.biweeklyAnchor).toLocaleDateString()}</Text>
            </TouchableOpacity>
          </>
        )}

        {settings.periodType === "monthly" && (
          <>
            <Text style={styles.hint}>Day of month period starts (1-28)</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={String(settings.monthlyStartDay)}
              onChangeText={(v) => {
                const n = Math.max(1, Math.min(28, parseInt(v, 10) || 1));
                patch({ monthlyStartDay: n });
              }}
            />
          </>
        )}

        <Text style={styles.sectionLabel}>Include in timesheet</Text>
        <View style={styles.optionRow}>
          <Text style={styles.optionLabel}>Earnings</Text>
          <Switch value={settings.includeEarnings} onValueChange={(v) => patch({ includeEarnings: v })} />
        </View>
        <View style={styles.optionRow}>
          <Text style={styles.optionLabel}>Notes</Text>
          <Switch value={settings.includeNotes} onValueChange={(v) => patch({ includeNotes: v })} />
        </View>
        <View style={styles.optionRow}>
          <Text style={styles.optionLabel}>Start/end times</Text>
          <Switch value={settings.includeTimes} onValueChange={(v) => patch({ includeTimes: v })} />
        </View>

        <Text style={styles.sectionLabel}>Submission format</Text>
        <View style={styles.chipRow}>
          {FORMATS.map((f) => (
            <TouchableOpacity
              key={f.key}
              style={[styles.chip, settings.format === f.key && styles.chipSelected]}
              onPress={() => patch({ format: f.key })}
            >
              <Text style={[styles.chipText, settings.format === f.key && styles.chipTextSelected]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Send to</Text>
        {managers.length === 0 && <Text style={styles.hint}>No managers yet — add one below.</Text>}
        {managers.map((m) => (
          <ManagerRow key={m.id} manager={m} selected={settings.managerIds.includes(m.id)} onToggle={() => toggleManager(m.id)} />
        ))}
        <View style={styles.addManagerRow}>
          <TextInput style={[styles.input, styles.addManagerInput]} placeholder="Name" value={newName} onChangeText={setNewName} />
          <TextInput
            style={[styles.input, styles.addManagerInput]}
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

        {modal}
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  title: { fontSize: 18, fontWeight: "700" },
  doneText: { color: "#2563eb", fontWeight: "600", fontSize: 15 },
  sectionLabel: { fontWeight: "600", color: "#444", marginTop: 12, marginBottom: 6, fontSize: 13 },
  hint: { color: "#999", fontSize: 12, marginBottom: 6 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderColor: "#ddd", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6 },
  dayChip: { borderWidth: 1, borderColor: "#ddd", borderRadius: 14, paddingHorizontal: 8, paddingVertical: 6 },
  chipSelected: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  chipText: { color: "#333", fontSize: 13 },
  chipTextSelected: { color: "#fff", fontWeight: "600" },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 8, marginTop: 4, backgroundColor: "#fff" },
  optionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  optionLabel: { fontSize: 14, color: "#333" },
  managerRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#eee", gap: 6 },
  checkbox: { padding: 4 },
  checkboxBox: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: "#999", alignItems: "center", justifyContent: "center" },
  checkboxBoxChecked: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  checkmark: { color: "#fff", fontSize: 13, fontWeight: "700" },
  managerName: { fontSize: 14, fontWeight: "500" },
  managerEmail: { color: "#666", fontSize: 12 },
  archivedText: { color: "#999", textDecorationLine: "line-through" },
  rowAction: { paddingHorizontal: 5, paddingVertical: 3 },
  rowActionText: { color: "#2563eb", fontSize: 12 },
  deleteText: { color: "#dc2626" },
  addManagerRow: { flexDirection: "row", gap: 6, marginTop: 8 },
  addManagerInput: { flex: 1 },
  secondaryButton: { marginTop: 8, marginBottom: 24, alignItems: "center", padding: 8, borderRadius: 8, borderWidth: 1, borderColor: "#2563eb" },
  secondaryButtonText: { color: "#2563eb", fontWeight: "600", fontSize: 13 },
});
