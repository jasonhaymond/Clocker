import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";

// Optional fingerprint/biometric lock on opening the app — Android only for now (see
// STATUS.md/the plan this shipped from for why iOS support wasn't pursued this round).
// The preference itself is device-local (AsyncStorage, not synced): whether to require
// this is about this device, not the account, the same reasoning locationTracking.ts's
// pending-prompt queue and staleShiftReminder.ts's notification-id map use.
//
// Requires a custom Expo dev/production build; does NOT work in Expo Go (same as every
// other native-module feature in this app).
//
// NEVER RUN ON A REAL DEVICE FROM ANY CLAUDE SESSION — no Android device/emulator access
// was available. Written directly against expo-local-authentication's shipped .d.ts files
// (hasHardwareAsync/isEnrolledAsync/authenticateAsync), not verified end-to-end. Test this
// for real before trusting it.

const ENABLED_KEY = "clocker.appLockEnabled";

export async function isAppLockAvailable(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  const [hasHardware, isEnrolled] = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]);
  return hasHardware && isEnrolled;
}

export async function isAppLockEnabled(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  return (await AsyncStorage.getItem(ENABLED_KEY)) === "true";
}

export async function setAppLockEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(ENABLED_KEY, enabled ? "true" : "false");
}

export async function authenticate(): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: "Unlock Clocker" });
    return result.success;
  } catch {
    return false;
  }
}
