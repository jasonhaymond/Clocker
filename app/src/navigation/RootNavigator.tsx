import Ionicons from "@expo/vector-icons/Ionicons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { DarkTheme, DefaultTheme, NavigationContainer } from "@react-navigation/native";
import React, { useEffect, useRef, useState } from "react";
import { Alert, AppState, ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../auth/AuthContext";
import { authenticate, isAppLockAvailable, isAppLockEnabled } from "../lib/appLock";
import { clockIn, clockOut, getJob, getLastActivityByJob, getOpenShiftForJob, getOpenShifts, listJobs } from "../db/database";
import { dbEvents } from "../lib/events";
import { syncGeofences, takePendingLocationPrompts, type PendingLocationPrompt } from "../lib/locationTracking";
import { initQuickActionHandling, updateQuickActions } from "../lib/quickActions";
import { AppLockScreen } from "../screens/AppLockScreen";
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

// The brand mark + wordmark, matching web's own header (see web/src/App.tsx's
// .brand-title). headerTintColor already covers a plain string headerTitle, but a custom
// component needs its own explicit color.
function HeaderTitle({ colors }: { colors: ThemeColors }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Image source={require("../../assets/logo-mark-inverted.png")} style={{ width: 24, height: 24 }} />
      <Text style={{ fontSize: 17, fontWeight: "600", color: colors.headerText }}>Clocker</Text>
    </View>
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

// Shows one queued "you've arrived/left — clock in/out?" prompt (see
// locationTracking.ts's PendingLocationPrompt) and waits for the user to respond before
// resolving, so checkPendingLocationPrompts can show a queue of them one at a time rather
// than stacking several Alerts on top of each other.
function showLocationPrompt(job: { id: string; name: string }, prompt: PendingLocationPrompt, openShiftId: string | null): Promise<void> {
  const isEnter = prompt.eventType === "enter";
  return new Promise((resolve) => {
    Alert.alert(isEnter ? `You've arrived at ${job.name}` : `You've left ${job.name}`, isEnter ? "Clock in now?" : "Clock out now?", [
      { text: "Not now", style: "cancel", onPress: () => resolve() },
      {
        text: isEnter ? "Clock In" : "Clock Out",
        onPress: async () => {
          try {
            if (isEnter) {
              await clockIn(job.id);
            } else if (openShiftId) {
              await clockOut(openShiftId);
            }
            synchronize().catch(() => {});
          } finally {
            resolve();
          }
        },
      },
    ]);
  });
}

// Runs at mount (covers a cold launch with a prompt already queued from before the app
// was opened) and every time the app returns to the foreground. Re-checks each prompt's
// job/shift state before showing it — the underlying situation may have already been
// resolved manually (or by a previous prompt) since the geofence event that queued it.
async function checkPendingLocationPrompts(): Promise<void> {
  const prompts = await takePendingLocationPrompts();
  for (const prompt of prompts) {
    const job = await getJob(prompt.jobId);
    if (!job || job.deletedAt) continue;
    const openShift = await getOpenShiftForJob(job.id);
    const isEnter = prompt.eventType === "enter";
    if (isEnter && openShift) continue; // already clocked in
    if (!isEnter && !openShift) continue; // already clocked out
    await showLocationPrompt(job, prompt, openShift?.id ?? null);
  }
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
    checkPendingLocationPrompts().catch(() => {});
    const interval = setInterval(() => synchronize().catch(() => {}), SYNC_INTERVAL_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        synchronize().catch(() => {});
        checkForUpdate().catch(() => {});
        checkPendingLocationPrompts().catch(() => {});
      }
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, []);

  // Keeps the active geofence set (see app/src/lib/locationTracking.ts) in sync with
  // whatever job location settings currently exist — runs once at mount and again
  // whenever any local write happens, since a job's location/awareness/auto settings
  // could have just changed in JobDetailModal.
  useEffect(() => {
    function refreshGeofences() {
      listJobs(false)
        .then((jobs) => syncGeofences(jobs))
        .catch(() => {});
    }
    refreshGeofences();
    return dbEvents.subscribe(refreshGeofences);
  }, []);

  // Keeps the Android home-screen quick action pointed at whichever job you'd most likely
  // want to clock into next — same recency data ClockScreen.tsx's job picker sorts by,
  // excluding whatever's already clocked in. Also wires up handling a tap on that action,
  // both the cold-start and already-running cases (see quickActions.ts).
  useEffect(() => {
    function refreshQuickActionJob() {
      Promise.all([listJobs(false), getOpenShifts(), getLastActivityByJob()]).then(([jobs, openShifts, lastActivity]) => {
        const openJobIds = new Set(openShifts.map((s) => s.jobId));
        const candidates = jobs.filter((j) => !openJobIds.has(j.id));
        candidates.sort((a, b) => {
          const aLast = lastActivity[a.id];
          const bLast = lastActivity[b.id];
          if (aLast && bLast) return bLast.localeCompare(aLast);
          if (aLast) return -1;
          if (bLast) return 1;
          return 0;
        });
        updateQuickActions(candidates[0] ?? null);
      });
    }
    refreshQuickActionJob();
    const unsubscribeDb = dbEvents.subscribe(refreshQuickActionJob);
    const unsubscribeQuickActions = initQuickActionHandling();
    return () => {
      unsubscribeDb();
      unsubscribeQuickActions();
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
          headerTitle: () => <HeaderTitle colors={colors} />,
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

// How long the app can sit backgrounded before app-lock re-locks it — long enough that a
// quick app-switch (checking a notification, answering a call) doesn't demand a
// fingerprint every time, short enough that leaving the phone somewhere still locks it
// out in practice.
const APP_LOCK_GRACE_MS = 30_000;

function useAppLock(isSignedIn: boolean) {
  const [checking, setChecking] = useState(true);
  const [locked, setLocked] = useState(false);
  const enabledRef = useRef(false);
  const backgroundedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isSignedIn) {
      setChecking(false);
      return;
    }
    let cancelled = false;
    Promise.all([isAppLockEnabled(), isAppLockAvailable()]).then(([enabled, available]) => {
      if (cancelled) return;
      // If the user enabled this but then removed their device's fingerprint enrollment,
      // don't strand them locked out of the app with no way back in.
      enabledRef.current = enabled && available;
      setLocked(enabledRef.current);
      setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isSignedIn]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") {
        backgroundedAtRef.current = Date.now();
        return;
      }
      if (state !== "active" || !enabledRef.current) return;
      const backgroundedAt = backgroundedAtRef.current;
      backgroundedAtRef.current = null;
      if (backgroundedAt != null && Date.now() - backgroundedAt > APP_LOCK_GRACE_MS) {
        setLocked(true);
      }
    });
    return () => subscription.remove();
  }, []);

  async function unlock(): Promise<boolean> {
    const success = await authenticate();
    if (success) setLocked(false);
    return success;
  }

  return { checking, locked, unlock };
}

export function RootNavigator() {
  const { isReady, isSignedIn } = useAuth();
  const { colors } = useTheme();
  const { checking: checkingAppLock, locked, unlock } = useAppLock(isSignedIn);

  if (!isReady || checkingAppLock) {
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
      {isSignedIn ? locked ? <AppLockScreen onUnlock={unlock} /> : <AppTabs colors={colors} /> : <LoginScreen />}
    </NavigationContainer>
  );
}
