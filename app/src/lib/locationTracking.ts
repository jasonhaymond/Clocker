import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import AsyncStorage from "@react-native-async-storage/async-storage";
import notifee, { AndroidImportance } from "react-native-notify-kit";
import { Platform } from "react-native";
import { clockIn, clockOut, getJob, getOpenShiftForJob } from "../db/database";
import { synchronize } from "../sync/sync";
import type { Job } from "@clocker/shared";

// Location-based clock in/out, per job — "location awareness" queues a clock-in/out
// prompt when you arrive at or leave a job's saved location, "auto clock in/out" does it
// silently. Both are opt-in per job (see updateJobLocationAwareness/updateJobAutoClockInOut
// in app/src/db/database.ts) and work on iOS and Android alike, since background
// geofencing is a core OS capability on both — unlike the Android-only persistent
// notification in clockedInNotification.ts, there's no platform gate on most of this file.
//
// Uses expo-location's native geofencing (Location.startGeofencingAsync/GeofencingEventType),
// backed by the OS's own region-monitoring (not continuous polling — this is the
// battery-efficient, OS-recommended approach), via expo-task-manager. Requires a custom
// Expo dev/production build; does NOT work in Expo Go (see docs/development.md).
//
// NEVER RUN ON A REAL DEVICE FROM ANY CLAUDE SESSION — no iOS/Android device or emulator
// access was available. This is written directly against expo-location's documented API
// (requestForegroundPermissionsAsync/requestBackgroundPermissionsAsync/
// startGeofencingAsync/stopGeofencingAsync/hasStartedGeofencingAsync/
// getCurrentPositionAsync, TaskManager.defineTask), not verified end-to-end. The
// permission prompts, background wake-up, and actual geofence triggering all need a real
// device and a dev build — test this for real before trusting it.

const GEOFENCE_TASK_NAME = "clocker-location-geofence";
const LOCATION_CHANNEL_ID = "location-events";
const PENDING_PROMPTS_KEY = "clocker.pendingLocationPrompts";

export const LOCATION_RADIUS_OPTIONS_METERS = [100, 250, 500, 1000] as const;
export const DEFAULT_LOCATION_RADIUS_METERS = 250;

// Notification channel for location-triggered events (auto clock in/out confirmations,
// awareness prompts) — separate from clockedInNotification.ts's "clocked-in" channel:
// this one is a plain dismissible notification, not an ongoing foreground-service one.
// Android only (channels have no iOS equivalent); created eagerly at module load for the
// same reason clockedInNotification.ts does — see that file's own comment on why lazy
// channel creation caused a visible delay.
if (Platform.OS === "android") {
  notifee.createChannel({ id: LOCATION_CHANNEL_ID, name: "Location Clock In/Out", importance: AndroidImportance.DEFAULT }).catch(() => {});
}

async function postLocationEventNotification(title: string, body: string): Promise<void> {
  await notifee
    .displayNotification({
      title,
      body,
      android: { channelId: LOCATION_CHANNEL_ID, importance: AndroidImportance.DEFAULT },
    })
    .catch(() => {});
}

export interface PendingLocationPrompt {
  jobId: string;
  eventType: "enter" | "exit";
  at: string;
}

async function readPendingPrompts(): Promise<PendingLocationPrompt[]> {
  const raw = await AsyncStorage.getItem(PENDING_PROMPTS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PendingLocationPrompt[];
  } catch {
    return [];
  }
}

async function addPendingLocationPrompt(prompt: PendingLocationPrompt): Promise<void> {
  const existing = await readPendingPrompts();
  existing.push(prompt);
  await AsyncStorage.setItem(PENDING_PROMPTS_KEY, JSON.stringify(existing));
}

// Reads and clears the pending-prompt queue atomically, so the caller (RootNavigator, on
// every app-foreground) can show each one without worrying about a prompt being shown
// twice, or a new one arriving mid-processing being silently dropped.
export async function takePendingLocationPrompts(): Promise<PendingLocationPrompt[]> {
  const prompts = await readPendingPrompts();
  if (prompts.length > 0) await AsyncStorage.removeItem(PENDING_PROMPTS_KEY);
  return prompts;
}

async function handleAutoEvent(job: Job, isEnter: boolean): Promise<void> {
  const openShift = await getOpenShiftForJob(job.id);
  // Duplicate/out-of-order Enter/Exit events are normal with real GPS (a geofence can
  // fire more than once around its boundary) — checking current state first, rather than
  // just calling clockIn/clockOut and catching the resulting error, keeps this correct
  // without relying on matching an error message.
  if (isEnter && openShift) return;
  if (!isEnter && !openShift) return;

  if (isEnter) {
    await clockIn(job.id);
  } else if (openShift) {
    await clockOut(openShift.id);
  }
  synchronize().catch(() => {});
  const now = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  await postLocationEventNotification(isEnter ? `Auto clocked in — ${job.name}` : `Auto clocked out — ${job.name}`, `At ${now}`);
}

async function handleAwarenessEvent(job: Job, isEnter: boolean): Promise<void> {
  const openShift = await getOpenShiftForJob(job.id);
  if (isEnter && openShift) return; // already clocked in — nothing to prompt for
  if (!isEnter && !openShift) return; // already clocked out — nothing to prompt for

  await addPendingLocationPrompt({ jobId: job.id, eventType: isEnter ? "enter" : "exit", at: new Date().toISOString() });
  await postLocationEventNotification(
    isEnter ? `You've arrived at ${job.name}` : `You've left ${job.name}`,
    `Open Clocker to clock ${isEnter ? "in" : "out"}.`,
  );
}

// Must be called at module scope, before the app renders — Expo's own requirement for
// TaskManager tasks. This file is imported for its side effect from app/index.ts, right
// alongside clockedInNotification.ts.
TaskManager.defineTask(GEOFENCE_TASK_NAME, async ({ data, error }) => {
  if (error) return;
  const event = data as { eventType: Location.GeofencingEventType; region: Location.LocationRegion } | undefined;
  const jobId = event?.region?.identifier;
  if (!jobId || !event) return;

  const job = await getJob(jobId);
  if (!job || job.deletedAt || job.archived) return;

  const isEnter = event.eventType === Location.GeofencingEventType.Enter;
  const isExit = event.eventType === Location.GeofencingEventType.Exit;
  if (!isEnter && !isExit) return;

  if (job.autoClockInOutEnabled) {
    await handleAutoEvent(job, isEnter);
  } else if (job.locationAwarenessEnabled) {
    await handleAwarenessEvent(job, isEnter);
  }
});

export type LocationPermissionResult = "granted" | "foreground-only" | "denied";

// Requests foreground permission first, then background — the platform-recommended
// two-step flow (and, on iOS, the only order Apple allows; you can't request "Always"
// directly). Call this from the UI the moment a job's Awareness switch is turned on for
// the first time, not silently on app mount — a background-location prompt is heavy
// enough that it should be tied to a visible, explicit action.
export async function requestLocationPermissions(): Promise<LocationPermissionResult> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== "granted") return "denied";
  await notifee.requestPermission().catch(() => {});
  const background = await Location.requestBackgroundPermissionsAsync();
  return background.status === "granted" ? "granted" : "foreground-only";
}

// For the "Use My Current Location" button — requests foreground permission if not
// already granted (it's a much lighter ask than background, fine to do inline here),
// then reads a single position. Returns null if permission was denied.
export async function getCurrentLocation(): Promise<{ latitude: number; longitude: number } | null> {
  const existing = await Location.getForegroundPermissionsAsync();
  if (existing.status !== "granted") {
    const requested = await Location.requestForegroundPermissionsAsync();
    if (requested.status !== "granted") return null;
  }
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { latitude: position.coords.latitude, longitude: position.coords.longitude };
}

// Computes the desired geofence region set from the current job list (every non-archived
// job with a location set and at least one of the two switches on) and replaces whatever
// is currently registered to match. Idempotent and cheap — safe to call on every
// job-list change (RootNavigator does, via dbEvents) rather than diffing beforehand.
export async function syncGeofences(jobs: Job[]): Promise<void> {
  const regions: Location.LocationRegion[] = jobs
    .filter(
      (j) =>
        !j.archived &&
        j.locationLatitude != null &&
        j.locationLongitude != null &&
        (j.locationAwarenessEnabled || j.autoClockInOutEnabled),
    )
    .map((j) => ({
      identifier: j.id,
      latitude: j.locationLatitude as number,
      longitude: j.locationLongitude as number,
      radius: j.locationRadiusMeters ?? DEFAULT_LOCATION_RADIUS_METERS,
      notifyOnEnter: true,
      notifyOnExit: true,
    }));

  if (regions.length === 0) {
    const alreadyStarted = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME).catch(() => false);
    if (alreadyStarted) await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME).catch(() => {});
    return;
  }
  await Location.startGeofencingAsync(GEOFENCE_TASK_NAME, regions).catch(() => {});
}
