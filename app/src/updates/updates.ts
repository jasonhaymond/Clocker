import * as Updates from "expo-updates";
import { updateState } from "./updateState";

// OTA updates only do anything in a build published through EAS Update (a production/
// preview build, or a dev client pointed at a real update branch) — in Expo Go and local
// dev builds `Updates.isEnabled` is false, so every call here becomes a safe no-op.
export const otaUpdatesSupported = Updates.isEnabled;

export const currentRuntimeInfo = {
  runtimeVersion: Updates.runtimeVersion,
  channel: Updates.channel,
  updateId: Updates.updateId,
};

let downloadedUpdate = false;

// Checks for, and eagerly downloads, a pending OTA update. Safe to call opportunistically
// (app launch, foreground, or a manual "Check for Updates" tap) — it's a no-op while a
// download is already in flight or once one has finished (call applyUpdate() instead).
export async function checkForUpdate(): Promise<void> {
  if (!otaUpdatesSupported) {
    updateState.set({ status: "unsupported", error: null, checkedAt: new Date().toISOString() });
    return;
  }
  if (downloadedUpdate || updateState.get().status === "downloading") return;

  updateState.set({ status: "checking", error: null });
  try {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) {
      updateState.set({ status: "up-to-date", checkedAt: new Date().toISOString() });
      return;
    }
    updateState.set({ status: "downloading" });
    await Updates.fetchUpdateAsync();
    downloadedUpdate = true;
    updateState.set({ status: "ready", checkedAt: new Date().toISOString() });
  } catch (e: any) {
    updateState.set({ status: "error", error: e?.message ?? "Update check failed", checkedAt: new Date().toISOString() });
  }
}

export async function applyUpdate(): Promise<void> {
  if (!downloadedUpdate) return;
  await Updates.reloadAsync();
}
