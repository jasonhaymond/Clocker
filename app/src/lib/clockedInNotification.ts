import notifee, { AndroidImportance } from "react-native-notify-kit";
import { Platform } from "react-native";

// A persistent (non-dismissible) Android notification while clocked into any job, showing
// job name, start time, and elapsed time — via a real Android foreground service (not just
// a "sticky" notification flag), so it survives the app being backgrounded. Android only:
// iOS has no equivalent concept, and the user's request was Android-specific.
//
// react-native-notify-kit is a maintained fork of Notifee (archived by its author in April
// 2026) — same API, different package name. Requires a custom Expo dev/production build;
// does NOT work in Expo Go (see docs/development.md and app.config.js's plugin config).
//
// NEVER RUN ON A REAL DEVICE FROM ANY CLAUDE SESSION — no Android device/emulator access
// was available. This is written directly against the library's shipped .d.ts files
// (registerForegroundService/displayNotification/stopForegroundService/createChannel/
// requestPermission), not verified end-to-end. Test this for real before trusting it.

const CHANNEL_ID = "clocked-in";
const NOTIFICATION_ID = "clocked-in-status";

// Notifee's foreground service model requires a registered "long running task" — this
// Promise deliberately never resolves. The service's actual lifetime is controlled by
// displayNotification (starts/updates it) and stopForegroundService (ends it) below, not
// by this task returning.
//
// Both this and channel creation used to happen lazily, on the first clock-in of a given
// app run. That's the reported cause of the notification sometimes taking several seconds
// to a minute to actually appear: Notifee's own docs call for registering the foreground
// service "as early as possible in the application life cycle," alongside the root
// component's registration, precisely because doing it lazily races the native side
// against whatever the JS thread happens to be busy with (navigation mount, initial data
// load, ...) right at the moment of that first clock-in. Registering unconditionally here,
// at module load — this file is imported from app/index.ts, before the app even renders —
// means both are already done by the time any real clock-in can happen.
if (Platform.OS === "android") {
  notifee.registerForegroundService(() => new Promise(() => {}));
  notifee.createChannel({ id: CHANNEL_ID, name: "Clocked In Status", importance: AndroidImportance.LOW }).catch(() => {});
}

export async function requestClockedInNotificationPermission(): Promise<void> {
  if (Platform.OS !== "android") return;
  await notifee.requestPermission();
}

export interface ClockedInJobStatus {
  jobName: string;
  jobColorHex: string;
  clockInIso: string;
  workedMs: number;
}

function formatLine(status: ClockedInJobStatus): string {
  const hours = Math.floor(status.workedMs / 3_600_000);
  const minutes = Math.floor((status.workedMs % 3_600_000) / 60_000);
  const since = new Date(status.clockInIso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${status.jobName}: ${hours}h ${minutes.toString().padStart(2, "0")}m (since ${since})`;
}

// Notifee/react-native-notify-kit only allows a single foreground service per app, so
// clocking into more than one job at once folds every open shift into one notification
// (one line per job) rather than showing several simultaneous notifications. There's only
// one small-icon dot to color in that case, so it's tinted with whichever job has been
// open longest (statuses[0], same ordering ClockScreen already loads open shifts in).
export async function updateClockedInNotification(statuses: ClockedInJobStatus[]): Promise<void> {
  if (Platform.OS !== "android") return;
  if (statuses.length === 0) {
    await stopClockedInNotification();
    return;
  }

  // The common case — exactly one open shift — gets Android's own native chronometer
  // instead of a formatted "Xh Ym" string we'd have to keep refreshing from JS. That
  // refresh was the actual bug reported: once the app's JS thread gets throttled in the
  // background (which Android does fairly aggressively, foreground service or not), the
  // periodic re-render that used to update this text just stops firing, so the elapsed
  // time you see is whatever it was the last time the JS thread happened to be running.
  // A chronometer sidesteps that entirely — given a start timestamp, the OS itself keeps
  // it ticking every second in the notification tray with zero ongoing app involvement.
  // With more than one job open at once there's only one chronometer slot per
  // notification, so that case keeps the old formatted-text approach, still refreshed by
  // ClockScreen's 30s tick — a rare enough situation (two jobs clocked in simultaneously)
  // that it isn't worth solving as thoroughly as the normal single-job case.
  const single = statuses.length === 1 ? statuses[0] : null;
  const title = single ? `Clocked in — ${single.jobName}` : `Clocked in — ${statuses.length} jobs`;
  const body = single
    ? `Since ${new Date(single.clockInIso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : statuses.map(formatLine).join("\n");

  await notifee.displayNotification({
    id: NOTIFICATION_ID,
    title,
    body,
    android: {
      channelId: CHANNEL_ID,
      asForegroundService: true,
      ongoing: true,
      importance: AndroidImportance.LOW,
      color: statuses[0].jobColorHex,
      ...(single
        ? { showChronometer: true, chronometerDirection: "up" as const, timestamp: new Date(single.clockInIso).getTime() }
        : {}),
    },
  });
}

export async function stopClockedInNotification(): Promise<void> {
  if (Platform.OS !== "android") return;
  await notifee.stopForegroundService();
}
