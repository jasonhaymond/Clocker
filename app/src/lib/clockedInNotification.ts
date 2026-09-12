import notifee, { AndroidImportance } from "react-native-notify-kit";
import { Platform } from "react-native";

// A persistent (non-dismissible) Android notification while clocked into any job, showing
// job name, start time, and elapsed time — via a real Android foreground service (not just
// a "sticky" notification flag), so it survives the app being backgrounded. Android only:
// iOS has no equivalent concept, and the user's request was Android-specific.
//
// react-native-notify-kit is a maintained fork of Notifee (archived by its author in April
// 2026) — same API, different package name. Requires a custom Expo dev/production build;
// does NOT work in Expo Go (see docs/development.md and app.json's plugin config).
//
// NEVER RUN ON A REAL DEVICE FROM ANY CLAUDE SESSION — no Android device/emulator access
// was available. This is written directly against the library's shipped .d.ts files
// (registerForegroundService/displayNotification/stopForegroundService/createChannel/
// requestPermission), not verified end-to-end. Test this for real before trusting it.

const CHANNEL_ID = "clocked-in";
const NOTIFICATION_ID = "clocked-in-status";

let channelReady = false;
let serviceRegistered = false;

async function ensureChannel(): Promise<void> {
  if (channelReady) return;
  await notifee.createChannel({ id: CHANNEL_ID, name: "Clocked In Status", importance: AndroidImportance.LOW });
  channelReady = true;
}

// Notifee's foreground service model requires a registered "long running task" — this
// Promise deliberately never resolves. The service's actual lifetime is controlled by
// displayNotification (starts/updates it) and stopForegroundService (ends it) below, not
// by this task returning.
function ensureForegroundServiceRegistered(): void {
  if (serviceRegistered) return;
  notifee.registerForegroundService(() => new Promise(() => {}));
  serviceRegistered = true;
}

export async function requestClockedInNotificationPermission(): Promise<void> {
  if (Platform.OS !== "android") return;
  await notifee.requestPermission();
}

export interface ClockedInJobStatus {
  jobName: string;
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
// (one line per job) rather than showing several simultaneous notifications.
export async function updateClockedInNotification(statuses: ClockedInJobStatus[]): Promise<void> {
  if (Platform.OS !== "android") return;
  if (statuses.length === 0) {
    await stopClockedInNotification();
    return;
  }

  await ensureChannel();
  ensureForegroundServiceRegistered();

  const title = statuses.length === 1 ? `Clocked in — ${statuses[0].jobName}` : `Clocked in — ${statuses.length} jobs`;
  const body = statuses.map(formatLine).join("\n");

  await notifee.displayNotification({
    id: NOTIFICATION_ID,
    title,
    body,
    android: {
      channelId: CHANNEL_ID,
      asForegroundService: true,
      ongoing: true,
      importance: AndroidImportance.LOW,
    },
  });
}

export async function stopClockedInNotification(): Promise<void> {
  if (Platform.OS !== "android") return;
  await notifee.stopForegroundService();
}
