import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";

// "system" (the default) follows the OS via useColorScheme, which itself updates live on
// an OS-level theme change with no extra listener needed here. "light"/"dark" are
// explicit overrides, persisted so they survive a relaunch.
export type ThemeMode = "system" | "light" | "dark";

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceAlt: string;
  card: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textMuted2: string;
  textMuted3: string;
  border: string;
  borderStrong: string;
  primary: string;
  onPrimary: string;
  danger: string;
  dangerBg: string;
  dangerBorder: string;
  dangerText: string;
  success: string;
  successBg: string;
  successText: string;
  warning: string;
  overlay: string;
  headerBg: string;
  headerText: string;
  invertBg: string;
  invertText: string;
  selectedBg: string;
  isDark: boolean;
}

// Deliberately mirrors web/src/index.css's token names/values (see that file's comment
// block) so the two clients read as the same app — brand/semantic colors (primary,
// danger, success, warning) stay close to constant across themes; only the neutral
// surface/text/border tokens actually swap.
const LIGHT: ThemeColors = {
  background: "#f7f8fa",
  surface: "#f7f8fa",
  surfaceAlt: "#eef0f3",
  card: "#fff",
  text: "#111",
  textSecondary: "#444",
  textMuted: "#888",
  textMuted2: "#999",
  textMuted3: "#666",
  border: "#eee",
  borderStrong: "#ddd",
  primary: "#1d4ed8",
  onPrimary: "#fff",
  danger: "#b91c1c",
  dangerBg: "#fef2f2",
  dangerBorder: "#fecaca",
  dangerText: "#991b1b",
  success: "#16a34a",
  successBg: "#dcfce7",
  successText: "#166534",
  warning: "#d97706",
  overlay: "rgba(0,0,0,0.4)",
  headerBg: "#1d4ed8",
  headerText: "#fff",
  invertBg: "#111",
  invertText: "#fff",
  selectedBg: "#eff6ff",
  isDark: false,
};

const DARK: ThemeColors = {
  background: "#121317",
  surface: "#1c1e24",
  surfaceAlt: "#262930",
  card: "#1a1c22",
  text: "#f2f2f2",
  textSecondary: "#c2c2c2",
  textMuted: "#9099a8",
  textMuted2: "#8b93a1",
  textMuted3: "#a0a8b5",
  border: "#2b2e36",
  borderStrong: "#3a3e47",
  primary: "#1d4ed8",
  onPrimary: "#fff",
  danger: "#f87171",
  dangerBg: "rgba(248,113,113,0.14)",
  dangerBorder: "rgba(248,113,113,0.35)",
  dangerText: "#fca5a5",
  success: "#4ade80",
  successBg: "rgba(74,222,128,0.14)",
  successText: "#86efac",
  warning: "#fbbf24",
  overlay: "rgba(0,0,0,0.6)",
  // Header stays the same brand blue as light mode on purpose (see web's equivalent
  // comment) — a constant identity element independent of the content theme.
  headerBg: "#1d4ed8",
  headerText: "#fff",
  invertBg: "#f2f2f2",
  invertText: "#111",
  selectedBg: "#1e3a5f",
  isDark: true,
};

const STORAGE_KEY = "clocker.theme";

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  colors: ThemeColors;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === "light" || stored === "dark" || stored === "system") setModeState(stored);
    });
  }, []);

  function setMode(next: ThemeMode) {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }

  const isDark = mode === "system" ? systemScheme === "dark" : mode === "dark";
  const colors = isDark ? DARK : LIGHT;
  const value = useMemo(() => ({ mode, setMode, colors }), [mode, colors]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
