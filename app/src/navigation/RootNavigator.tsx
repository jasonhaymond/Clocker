import Ionicons from "@expo/vector-icons/Ionicons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { DarkTheme, DefaultTheme, NavigationContainer } from "@react-navigation/native";
import React, { useEffect, useState } from "react";
import { AppState, ActivityIndicator, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../auth/AuthContext";
import { ClockScreen } from "../screens/ClockScreen";
import { ExportScreen } from "../screens/ExportScreen";
import { HelpScreen } from "../screens/HelpScreen";
import { HistoryScreen } from "../screens/HistoryScreen";
import { JobsScreen } from "../screens/JobsScreen";
import { LoginScreen } from "../screens/LoginScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { TimesheetsScreen } from "../screens/TimesheetsScreen";
import { useTheme, type ThemeColors } from "../theme/ThemeContext";
import { synchronize } from "../sync/sync";
import { checkForUpdate } from "../updates/updates";

const Tab = createBottomTabNavigator();

const SYNC_INTERVAL_MS = 5 * 60 * 1000;

const TAB_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Clock: "time-outline",
  Jobs: "briefcase-outline",
  History: "list-outline",
  Timesheets: "document-text-outline",
  Export: "share-outline",
};

const TAB_ICONS_FOCUSED: Record<string, keyof typeof Ionicons.glyphMap> = {
  Clock: "time",
  Jobs: "briefcase",
  History: "list",
  Timesheets: "document-text",
  Export: "share",
};

type Overlay = "settings" | "help" | null;

// Just the button — lives in headerRight's own constrained layout slot. The actual
// dropdown is a separate component (HeaderMenuDropdown, below) rendered as a true
// sibling of <Tab.Navigator> instead, because an absolutely-positioned full-screen
// dismiss backdrop needs to escape headerRight's small bounding box to actually cover
// the whole screen (including the tab bar) — it can't do that from inside the header's
// own layout slot.
function HeaderMenuButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity onPress={onPress} style={{ paddingHorizontal: 12 }} accessibilityLabel="Menu">
      <Ionicons name="menu" size={26} color={colors.headerText} />
    </TouchableOpacity>
  );
}

// Rough default header height per platform (Material default on Android, the standard
// native-stack/bottom-tabs default on iOS) — a reasonable approximation rather than the
// exact rendered height, since getting the exact value would need useHeaderHeight(),
// which only works from inside the navigator's own header context and this dropdown is
// deliberately rendered as a sibling of <Tab.Navigator> instead (see HeaderMenuButton's
// comment for why). A few pixels off is an acceptable trade for not needing a device to
// re-verify every time the header's own styling changes.
const APPROX_HEADER_HEIGHT = Platform.OS === "ios" ? 44 : 56;

// Matches web's HeaderMenu (web/src/App.tsx) exactly, both in what it offers (Settings +
// Help, since those two are reached less often than the 5 bottom-bar tabs) and how it
// behaves (closes on selecting an item, or on tapping anywhere else on screen).
function HeaderMenuDropdown({ overlay, onSelect, onDismiss }: { overlay: Overlay; onSelect: (o: Overlay) => void; onDismiss: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(() => createMenuStyles(colors), [colors]);

  return (
    <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss}>
      <View
        style={[styles.dropdown, { top: insets.top + APPROX_HEADER_HEIGHT + 4, right: 12 }]}
        // Swallow taps on the dropdown itself so they don't fall through to the
        // full-screen Pressable behind it and dismiss before onSelect runs.
        onStartShouldSetResponder={() => true}
      >
        <TouchableOpacity
          style={[styles.item, overlay === "settings" && styles.itemActive]}
          onPress={() => onSelect("settings")}
        >
          <Ionicons name="settings-outline" size={18} color={overlay === "settings" ? colors.primary : colors.text} />
          <Text style={[styles.itemText, overlay === "settings" && styles.itemTextActive]}>Settings</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.item, overlay === "help" && styles.itemActive]} onPress={() => onSelect("help")}>
          <Ionicons name="help-circle-outline" size={18} color={overlay === "help" ? colors.primary : colors.text} />
          <Text style={[styles.itemText, overlay === "help" && styles.itemTextActive]}>Help</Text>
        </TouchableOpacity>
      </View>
    </Pressable>
  );
}

function createMenuStyles(colors: ThemeColors) {
  return StyleSheet.create({
    dropdown: {
      position: "absolute",
      backgroundColor: colors.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      minWidth: 160,
      paddingVertical: 6,
      shadowColor: "#000",
      shadowOpacity: 0.2,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 8,
    },
    item: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
    itemActive: { backgroundColor: colors.selectedBg },
    itemText: { fontSize: 14, color: colors.text, fontWeight: "500" },
    itemTextActive: { color: colors.primary, fontWeight: "600" },
  });
}

function AppTabs({ colors }: { colors: ThemeColors }) {
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  function selectOverlay(next: Overlay) {
    setOverlay(next);
    setMenuOpen(false);
  }

  useEffect(() => {
    synchronize().catch(() => {});
    checkForUpdate().catch(() => {});
    const interval = setInterval(() => synchronize().catch(() => {}), SYNC_INTERVAL_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        synchronize().catch(() => {});
        checkForUpdate().catch(() => {});
      }
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, []);

  return (
    <>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: true,
          // Always the app name/brand, not the current screen — matches web (see
          // web/src/App.tsx). Which tab you're on is shown by the active tab icon below
          // instead. Branded header color, constant across light/dark (see ThemeContext).
          headerTitle: "Clocker",
          headerStyle: { backgroundColor: colors.headerBg },
          headerTintColor: colors.headerText,
          headerTitleStyle: { color: colors.headerText },
          headerRight: () => <HeaderMenuButton onPress={() => setMenuOpen((o) => !o)} />,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={(focused ? TAB_ICONS_FOCUSED : TAB_ICONS)[route.name]} color={color} size={size} />
          ),
        })}
      >
        <Tab.Screen name="Clock" component={ClockScreen} />
        <Tab.Screen name="Jobs" component={JobsScreen} />
        <Tab.Screen name="History" component={HistoryScreen} />
        <Tab.Screen name="Timesheets" component={TimesheetsScreen} />
        <Tab.Screen name="Export" component={ExportScreen} />
      </Tab.Navigator>
      {menuOpen && <HeaderMenuDropdown overlay={overlay} onSelect={selectOverlay} onDismiss={() => setMenuOpen(false)} />}
      {overlay === "settings" && <SettingsScreen onClose={() => setOverlay(null)} />}
      {overlay === "help" && <HelpScreen onClose={() => setOverlay(null)} />}
    </>
  );
}

export function RootNavigator() {
  const { isReady, isSignedIn } = useAuth();
  const { colors } = useTheme();

  if (!isReady) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  // React Navigation's own theme controls the default screen background shown behind/
  // between screens during transitions — without this it stays white regardless of our
  // own theme, which shows as a light flash/edge in dark mode.
  const navTheme = {
    ...(colors.isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(colors.isDark ? DarkTheme.colors : DefaultTheme.colors),
      background: colors.background,
      card: colors.card,
      text: colors.text,
      border: colors.border,
      primary: colors.primary,
    },
  };

  return (
    <NavigationContainer theme={navTheme}>
      {isSignedIn ? <AppTabs colors={colors} /> : <LoginScreen />}
    </NavigationContainer>
  );
}
