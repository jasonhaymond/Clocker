import React, { useCallback, useMemo, useState } from "react";
import { Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import {
  deleteBreak,
  endBreak,
  listBreaksForShift,
  startBreak,
  updateBreakTimes,
  updateShiftTimes,
} from "../db/database";
import { useDateTimePicker } from "../lib/useDateTimePicker";
import { useDbRefresh } from "../lib/useDbRefresh";
import { useTheme, type ThemeColors } from "../theme/ThemeContext";
import { formatClock, formatDay, type Break, type Shift } from "@clocker/shared";

// Full shift editor: notes (as before), plus clock-in/out times and breaks — reachable
// from History for any shift in the last 90 days, open or already clocked out. Setting a
// clock-out here on a still-open shift closes it, the same as "Clock Out At..." on the
// Clock screen; there's deliberately no way to *clear* an existing clock-out and reopen a
// shift, since a job can already have a newer open shift by the time you'd do that, and
// the rest of the app assumes at most one open shift per job.
export function ShiftEditor({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [notes, setNotes] = useState(shift.notes ?? "");
  const [breaks, setBreaks] = useState<Break[]>([]);
  const { pick, modal } = useDateTimePicker();

  const load = useCallback(() => {
    listBreaksForShift(shift.id).then(setBreaks);
  }, [shift.id]);
  useDbRefresh(load);

  async function saveNotes() {
    const trimmed = notes.trim();
    if (trimmed !== (shift.notes ?? "")) await updateShiftTimes(shift.id, { notes: trimmed || null });
  }

  async function editClockIn() {
    const date = await pick(new Date(shift.clockIn), "Clock In");
    if (!date) return;
    if (shift.clockOut && date.getTime() >= new Date(shift.clockOut).getTime()) {
      Alert.alert("Invalid time", "Clock-in must be before clock-out.");
      return;
    }
    await updateShiftTimes(shift.id, { clockIn: date.toISOString() });
  }

  async function editClockOut() {
    const date = await pick(shift.clockOut ? new Date(shift.clockOut) : new Date(), shift.clockOut ? "Clock Out" : "Set Clock Out");
    if (!date) return;
    if (date.getTime() <= new Date(shift.clockIn).getTime()) {
      Alert.alert("Invalid time", "Clock-out must be after clock-in.");
      return;
    }
    await updateShiftTimes(shift.id, { clockOut: date.toISOString() });
  }

  async function addBreak() {
    // Seeded as a zero-length break at the shift's start — immediately editable below,
    // same as any existing break, rather than a separate "new break" flow.
    const brk = await startBreak(shift.id, shift.clockIn);
    await endBreak(brk.id, shift.clockIn);
  }

  async function editBreakStart(brk: Break) {
    const date = await pick(new Date(brk.start), "Break Start");
    if (!date) return;
    if (brk.end && date.getTime() >= new Date(brk.end).getTime()) {
      Alert.alert("Invalid time", "Break start must be before its end.");
      return;
    }
    await updateBreakTimes(brk.id, { start: date.toISOString() });
  }

  async function editBreakEnd(brk: Break) {
    const date = await pick(brk.end ? new Date(brk.end) : new Date(), "Break End");
    if (!date) return;
    if (date.getTime() <= new Date(brk.start).getTime()) {
      Alert.alert("Invalid time", "Break end must be after its start.");
      return;
    }
    await updateBreakTimes(brk.id, { end: date.toISOString() });
  }

  function confirmDeleteBreak(brk: Break) {
    Alert.alert("Delete break", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteBreak(brk.id) },
    ]);
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 14 }}>
        <View style={styles.header}>
          <Text style={styles.title}>Edit Shift</Text>
        </View>

        <Text style={styles.sectionLabel}>{formatDay(shift.clockIn)}</Text>

        <View style={styles.timeRow}>
          <Text style={styles.timeLabel}>Clock in</Text>
          <TouchableOpacity onPress={editClockIn}>
            <Text style={styles.timeValue}>{formatClock(shift.clockIn)}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.timeRow}>
          <Text style={styles.timeLabel}>Clock out</Text>
          <TouchableOpacity onPress={editClockOut}>
            <Text style={styles.timeValue}>{shift.clockOut ? formatClock(shift.clockOut) : "Still clocked in — set..."}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>Breaks</Text>
        {breaks.length === 0 && <Text style={styles.hint}>No breaks recorded.</Text>}
        {breaks.map((brk) => (
          <View key={brk.id} style={styles.breakRow}>
            <TouchableOpacity onPress={() => editBreakStart(brk)} style={{ flex: 1 }}>
              <Text style={styles.timeValue}>{formatClock(brk.start)}</Text>
            </TouchableOpacity>
            <Text style={styles.hint}>–</Text>
            <TouchableOpacity onPress={() => editBreakEnd(brk)} style={{ flex: 1 }}>
              <Text style={styles.timeValue}>{brk.end ? formatClock(brk.end) : "ongoing — set..."}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => confirmDeleteBreak(brk)} style={styles.deleteAction}>
              <Text style={styles.deleteActionText}>Delete</Text>
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity style={styles.secondaryButton} onPress={addBreak}>
          <Text style={styles.secondaryButtonText}>+ Add Break</Text>
        </TouchableOpacity>

        <Text style={styles.sectionLabel}>Note</Text>
        <TextInput
          style={styles.notesInput}
          placeholder="Add a note about this shift..."
          value={notes}
          onChangeText={setNotes}
          multiline
        />

        {/* Only the note is draft state here — Cancel discards it. Clock in/out and break
            edits above each commit immediately via their own date/time picker, the same
            "commit per interaction" pattern used everywhere else in this app (rate
            tiers, job settings, ...); Cancel can't retroactively undo those. Note used to
            auto-save onBlur, which defeated the point of a Cancel button (tapping Cancel
            itself blurs the field first) — removed so it stays a draft until Done. */}
        <View style={styles.actions}>
          <TouchableOpacity onPress={onClose} style={styles.actionButton}>
            <Text style={styles.actionButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              saveNotes();
              onClose();
            }}
            style={[styles.actionButton, styles.actionButtonPrimary]}
          >
            <Text style={[styles.actionButtonText, styles.actionButtonPrimaryText]}>Done</Text>
          </TouchableOpacity>
        </View>

        {modal}
      </ScrollView>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.card },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
    title: { fontSize: 17, fontWeight: "700", color: colors.text },
    sectionLabel: { fontWeight: "600", color: colors.textSecondary, marginTop: 16, marginBottom: 6, fontSize: 13 },
    hint: { color: colors.textMuted2, fontSize: 12 },
    timeRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
    timeLabel: { color: colors.textMuted3, fontSize: 14 },
    timeValue: { color: colors.primary, fontWeight: "600", fontSize: 14 },
    breakRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
    deleteAction: { paddingHorizontal: 5, paddingVertical: 3 },
    deleteActionText: { color: colors.danger, fontSize: 12, fontWeight: "600" },
    secondaryButton: { marginTop: 8, alignItems: "center", padding: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.primary },
    secondaryButtonText: { color: colors.primary, fontWeight: "600", fontSize: 13 },
    notesInput: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 8, padding: 10, minHeight: 90, textAlignVertical: "top", color: colors.text },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 16 },
    actionButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
    actionButtonPrimary: { backgroundColor: colors.primary },
    actionButtonText: { fontWeight: "600", color: colors.textSecondary },
    actionButtonPrimaryText: { color: colors.onPrimary },
  });
}
