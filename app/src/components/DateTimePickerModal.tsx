import DateTimePicker from "@react-native-community/datetimepicker";
import React, { useState } from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";

// iOS-only rendering: Android is handled imperatively via pickDateTimeAndroid instead
// (see useDateTimePicker), since Android has no inline combined date+time widget worth
// rendering — its native dialogs are the better UX there.
export function DateTimePickerModal({
  visible,
  initialValue,
  title,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  initialValue: Date;
  title: string;
  onConfirm: (date: Date) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <DateTimePicker
            value={value}
            mode="datetime"
            display="spinner"
            onValueChange={(_, picked) => setValue(picked)}
          />
          <View style={styles.actions}>
            <TouchableOpacity onPress={onCancel} style={styles.button}>
              <Text style={styles.buttonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onConfirm(value)} style={[styles.button, styles.confirmButton]}>
              <Text style={[styles.buttonText, styles.confirmText]}>Set</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  card: { backgroundColor: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20 },
  title: { fontSize: 16, fontWeight: "700", marginBottom: 8, textAlign: "center" },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 12 },
  button: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  buttonText: { fontWeight: "600", color: "#333" },
  confirmButton: { backgroundColor: "#2563eb" },
  confirmText: { color: "#fff" },
});
