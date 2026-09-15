import Ionicons from "@expo/vector-icons/Ionicons";
import React, { useMemo } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTheme, type ThemeColors } from "../theme/ThemeContext";

// Shown instead of the app's tabs when app-lock is enabled and either the app just cold
// started or came back from the background after the grace period — see
// RootNavigator.tsx's use of this alongside app/src/lib/appLock.ts.
export function AppLockScreen({ onUnlock }: { onUnlock: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <Ionicons name="lock-closed" size={48} color={colors.primary} />
      <Text style={styles.title}>Clocker is locked</Text>
      <TouchableOpacity style={styles.button} onPress={onUnlock}>
        <Text style={styles.buttonText}>Unlock</Text>
      </TouchableOpacity>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, gap: 16 },
    title: { fontSize: 17, fontWeight: "600", color: colors.text },
    button: { backgroundColor: colors.primaryFill, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12 },
    buttonText: { color: colors.onPrimary, fontSize: 15, fontWeight: "700" },
  });
}
