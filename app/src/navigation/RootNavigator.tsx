import Ionicons from "@expo/vector-icons/Ionicons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { DarkTheme, DefaultTheme, NavigationContainer } from "@react-navigation/native";
import React, { useEffect } from "react";
import { AppState, ActivityIndicator, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { ClockScreen } from "../screens/ClockScreen";
import { ExportScreen } from "../screens/ExportScreen";
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
  Settings: "settings-outline",
};

const TAB_ICONS_FOCUSED: Record<string, keyof typeof Ionicons.glyphMap> = {
  Clock: "time",
  Jobs: "briefcase",
  History: "list",
  Timesheets: "document-text",
  Export: "share",
  Settings: "settings",
};

function AppTabs({ colors }: { colors: ThemeColors }) {
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
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
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
