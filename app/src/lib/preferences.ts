import AsyncStorage from "@react-native-async-storage/async-storage";

// Device-local UI preferences — never synced (there's nothing here another device would
// need, unlike everything in db/database.ts), same storage pattern as auth/tokenStore.ts.
// Timesheet period/format/manager settings used to live here too, but they're per-job
// configuration now (synced Job fields + JobManager rows — see db/database.ts's
// updateJobTimesheetSettings/updateJobRounding), not a device-local preference.
const PROMPT_FOR_NOTES_ON_CLOCK_OUT_KEY = "clocker.promptForNotesOnClockOut";

export async function getPromptForNotesOnClockOut(): Promise<boolean> {
  return (await AsyncStorage.getItem(PROMPT_FOR_NOTES_ON_CLOCK_OUT_KEY)) === "true";
}

export async function setPromptForNotesOnClockOut(value: boolean): Promise<void> {
  await AsyncStorage.setItem(PROMPT_FOR_NOTES_ON_CLOCK_OUT_KEY, value ? "true" : "false");
}
