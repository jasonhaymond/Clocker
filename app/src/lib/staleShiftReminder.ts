import AsyncStorage from "@react-native-async-storage/async-storage";
import notifee, { AndroidImportance, TriggerType } from "react-native-notify-kit";
import { Platform } from "react-native";

// "Forgot to clock out" reminders — a per-job threshold (Job.staleShiftReminderHours;
// null disables it for that job) fires a notification once an open shift has run that
// long. Scheduled as a single Notifee trigger notification at clock-in time, rather than
// any kind of periodic check — the OS's own AlarmManager fires it, so it works even with
// the app fully closed and needs no background-fetch dependency or reliance on the app's
// JS thread staying alive (the same class of bug the persistent notification's elapsed-
// time chronometer fix addressed — see clockedInNotification.ts).
//
// Requires a custom Expo dev/production build; does NOT work in Expo Go (same as every
// other native-module feature in this app — see docs/development.md).
//
// NEVER RUN ON A REAL DEVICE FROM ANY CLAUDE SESSION — no Android device/emulator access
// was available. Written directly against react-native-notify-kit's shipped .d.ts files
// (createTriggerNotification/cancelTriggerNotification/TriggerType), not verified
// end-to-end. Test this for real before trusting it.

const CHANNEL_ID = "stale-shift-reminder";
// Which shift each scheduled trigger notification belongs to, so clocking out can cancel
// it before it fires. Local-only bookkeeping (a notification id from one device's OS is
// meaningless anywhere else), so this lives in AsyncStorage rather than as a synced Shift
// field — see locationTracking.ts's PendingLocationPrompt for the same reasoning.
const NOTIFICATION_IDS_KEY = "clocker.staleShiftReminderNotificationIds";

if (Platform.OS === "android") {
  notifee.createChannel({ id: CHANNEL_ID, name: "Forgot to Clock Out", importance: AndroidImportance.DEFAULT }).catch(() => {});
}

async function readNotificationIds(): Promise<Record<string, string>> {
  const raw = await AsyncStorage.getItem(NOTIFICATION_IDS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

async function writeNotificationIds(ids: Record<string, string>): Promise<void> {
  await AsyncStorage.setItem(NOTIFICATION_IDS_KEY, JSON.stringify(ids));
}

// Called right after clocking in, if the job has a reminder threshold configured. A
// backdated clock-in (e.g. "Clock In At...") whose threshold has already passed schedules
// nothing — there's no meaningful "future" moment left to fire at.
export async function scheduleStaleShiftReminder(params: { shiftId: string; jobName: string; clockInIso: string; hours: number }): Promise<void> {
  const fireAt = new Date(params.clockInIso).getTime() + params.hours * 3_600_000;
  if (fireAt <= Date.now()) return;
  try {
    const notificationId = await notifee.createTriggerNotification(
      {
        title: "Still clocked in?",
        body: `You've been clocked into ${params.jobName} for ${params.hours} hours. If you forgot to clock out, you can do that now.`,
        android: { channelId: CHANNEL_ID, importance: AndroidImportance.DEFAULT },
      },
      { type: TriggerType.TIMESTAMP, timestamp: fireAt },
    );
    const ids = await readNotificationIds();
    ids[params.shiftId] = notificationId;
    await writeNotificationIds(ids);
  } catch {
    // Scheduling a reminder is a nice-to-have on top of a clock-in that already
    // succeeded — a failure here shouldn't surface as if clocking in itself failed.
  }
}

// Called right after clocking out — cancels the reminder if it hasn't fired yet. A no-op
// (not an error) if this shift never had one scheduled, e.g. its job has no threshold set.
export async function cancelStaleShiftReminder(shiftId: string): Promise<void> {
  const ids = await readNotificationIds();
  const notificationId = ids[shiftId];
  if (!notificationId) return;
  delete ids[shiftId];
  await writeNotificationIds(ids);
  await notifee.cancelTriggerNotification(notificationId).catch(() => {});
}
