import React, { useMemo, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { useTheme, type ThemeColors } from "../theme/ThemeContext";

export function ChangePasswordScreen({ onClose }: { onClose: () => void }) {
  const { changePassword } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  async function submit() {
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      setDone(true);
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <Text style={styles.title}>Change Password</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.doneText}>{done ? "Done" : "Cancel"}</Text>
          </TouchableOpacity>
        </View>

        {done ? (
          <Text style={styles.success}>
            Password changed. You're still signed in on this device — every other device or browser you were signed
            into now needs to sign in again.
          </Text>
        ) : (
          <>
            <TextInput
              style={styles.input}
              placeholder="Current password"
              secureTextEntry
              value={currentPassword}
              onChangeText={setCurrentPassword}
            />
            <TextInput
              style={styles.input}
              placeholder="New password"
              secureTextEntry
              value={newPassword}
              onChangeText={setNewPassword}
            />
            <TextInput
              style={[styles.input, mismatch && styles.inputError]}
              placeholder="Confirm new password"
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <TouchableOpacity
              style={styles.button}
              onPress={submit}
              disabled={busy || !currentPassword || newPassword.length < 8 || !confirmPassword}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Change Password</Text>}
            </TouchableOpacity>
          </>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.card, padding: 14 },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
    title: { fontSize: 17, fontWeight: "700", color: colors.text },
    doneText: { color: colors.primary, fontWeight: "600", fontSize: 15 },
    input: {
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 10,
      padding: 14,
      marginBottom: 12,
      fontSize: 16,
      color: colors.text,
      backgroundColor: colors.card,
    },
    inputError: { borderColor: colors.danger },
    button: { backgroundColor: colors.primaryFill, borderRadius: 10, padding: 16, alignItems: "center", marginTop: 8 },
    buttonText: { color: colors.onPrimary, fontSize: 16, fontWeight: "600" },
    error: { color: colors.danger, textAlign: "center", marginBottom: 8 },
    success: { color: colors.textSecondary, fontSize: 15, lineHeight: 22 },
  });
}
