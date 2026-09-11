import React, { useState } from "react";
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { updateShiftTimes } from "../db/database";

// Shared between History (editing an existing note) and the Clock screen (optionally
// prompting for one right after clocking out, per the job's promptForNotesOnClockOut
// setting).
export function ShiftNotesModal({
  shiftId,
  initialNotes,
  onClose,
}: {
  shiftId: string;
  initialNotes: string | null;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState(initialNotes ?? "");

  async function save() {
    await updateShiftTimes(shiftId, { notes: notes.trim() ? notes.trim() : null });
    onClose();
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Note</Text>
          <TextInput
            style={styles.input}
            placeholder="Add a note about this shift..."
            value={notes}
            onChangeText={setNotes}
            multiline
            autoFocus
          />
          <View style={styles.actions}>
            <TouchableOpacity onPress={onClose} style={styles.button}>
              <Text style={styles.buttonText}>Skip</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={save} style={[styles.button, styles.primaryButton]}>
              <Text style={[styles.buttonText, styles.primaryText]}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
  card: { backgroundColor: "#fff", borderRadius: 16, padding: 20 },
  title: { fontSize: 16, fontWeight: "700", marginBottom: 12 },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 12, minHeight: 100, textAlignVertical: "top" },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 16 },
  button: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  primaryButton: { backgroundColor: "#2563eb" },
  buttonText: { fontWeight: "600", color: "#333" },
  primaryText: { color: "#fff" },
});
