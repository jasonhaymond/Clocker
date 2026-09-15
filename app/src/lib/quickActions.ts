import * as QuickActions from "expo-quick-actions";
import { Platform } from "react-native";
import { clockIn } from "../db/database";
import { synchronize } from "../sync/sync";

// Android home-screen "quick action" (long-press the app icon) for the single most useful
// shortcut this app has: clocking in to whichever job you last used. `expo-quick-actions`
// is a well-known community package, not an Expo-org one like the other native modules
// this app uses — worth knowing if it ever needs upgrading/replacing.
//
// Requires a custom Expo dev/production build; does NOT work in Expo Go.
//
// NEVER RUN ON A REAL DEVICE FROM ANY CLAUDE SESSION — no Android device/emulator access
// was available. Written directly against expo-quick-actions's shipped .d.ts files
// (setItems/initial/addListener), not verified end-to-end. Test this for real before
// trusting it.

const CLOCK_IN_ACTION_ID = "clock-in-last-job";

// Called whenever the most-recently-used job changes (see RootNavigator.tsx) — replaces
// the whole shortcut list with just this one action, or clears it if there's no job to
// offer yet (no jobs at all, or the app hasn't loaded them yet).
export async function updateQuickActions(job: { id: string; name: string } | null): Promise<void> {
  if (Platform.OS !== "android") return;
  if (!job) {
    await QuickActions.setItems([]).catch(() => {});
    return;
  }
  await QuickActions.setItems([
    { id: CLOCK_IN_ACTION_ID, title: `Clock in to ${job.name}`, params: { jobId: job.id } },
  ]).catch(() => {});
}

async function handleQuickAction(action: QuickActions.Action | undefined): Promise<void> {
  if (!action || action.id !== CLOCK_IN_ACTION_ID) return;
  const jobId = action.params?.jobId;
  if (typeof jobId !== "string") return;
  try {
    await clockIn(jobId);
    synchronize().catch(() => {});
  } catch {
    // Already clocked into this job, or it was deleted since the shortcut was set — either
    // way, nothing useful to surface from a quick-action tap specifically.
  }
}

// Cold start (app launched by tapping the shortcut while fully closed) and warm/
// backgrounded taps are two different code paths per the library's own design — `initial`
// is a plain snapshot value read once at import time, while `addListener` covers taps
// that arrive while the app is already running. Call this once from the signed-in app's
// own mount effect (RootNavigator.tsx) — both paths only make sense once there's a
// database to clock into.
export function initQuickActionHandling(): () => void {
  if (Platform.OS !== "android") return () => {};
  handleQuickAction(QuickActions.initial).catch(() => {});
  const subscription = QuickActions.addListener((action) => {
    handleQuickAction(action).catch(() => {});
  });
  return () => subscription.remove();
}
