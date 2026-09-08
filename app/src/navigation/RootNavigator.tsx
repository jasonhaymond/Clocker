import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import React, { useEffect } from "react";
import { AppState, ActivityIndicator, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { ClockScreen } from "../screens/ClockScreen";
import { ExportScreen } from "../screens/ExportScreen";
import { HistoryScreen } from "../screens/HistoryScreen";
import { JobsScreen } from "../screens/JobsScreen";
import { LoginScreen } from "../screens/LoginScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { synchronize } from "../sync/sync";
import { checkForUpdate } from "../updates/updates";

const Tab = createBottomTabNavigator();

const SYNC_INTERVAL_MS = 5 * 60 * 1000;

function AppTabs() {
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
    <Tab.Navigator screenOptions={{ headerShown: true }}>
      <Tab.Screen name="Clock" component={ClockScreen} />
      <Tab.Screen name="Jobs" component={JobsScreen} />
      <Tab.Screen name="History" component={HistoryScreen} />
      <Tab.Screen name="Export" component={ExportScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const { isReady, isSignedIn } = useAuth();

  if (!isReady) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return <NavigationContainer>{isSignedIn ? <AppTabs /> : <LoginScreen />}</NavigationContainer>;
}
