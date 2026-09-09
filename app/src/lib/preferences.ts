import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_PERIOD_SETTINGS, type PeriodSettings } from "./timesheetPeriods";

// Device-local UI preferences — never synced (there's nothing here another device would
// need, unlike everything in db/database.ts), same storage pattern as auth/tokenStore.ts.
const PROMPT_FOR_NOTES_ON_CLOCK_OUT_KEY = "clocker.promptForNotesOnClockOut";

export async function getPromptForNotesOnClockOut(): Promise<boolean> {
  return (await AsyncStorage.getItem(PROMPT_FOR_NOTES_ON_CLOCK_OUT_KEY)) === "true";
}

export async function setPromptForNotesOnClockOut(value: boolean): Promise<void> {
  await AsyncStorage.setItem(PROMPT_FOR_NOTES_ON_CLOCK_OUT_KEY, value ? "true" : "false");
}

// ---- Timesheet tab: period definition + default submission settings ----

export type TimesheetExportFormat = "csv" | "text" | "both";

export interface TimesheetSettings extends PeriodSettings {
  managerIds: string[];
  format: TimesheetExportFormat;
  includeEarnings: boolean;
  includeNotes: boolean;
  includeTimes: boolean;
}

const TIMESHEET_SETTINGS_KEY = "clocker.timesheetSettings";

const DEFAULT_TIMESHEET_SETTINGS: TimesheetSettings = {
  ...DEFAULT_PERIOD_SETTINGS,
  managerIds: [],
  format: "both",
  includeEarnings: true,
  includeNotes: true,
  includeTimes: true,
};

export async function getTimesheetSettings(): Promise<TimesheetSettings> {
  const raw = await AsyncStorage.getItem(TIMESHEET_SETTINGS_KEY);
  if (!raw) return DEFAULT_TIMESHEET_SETTINGS;
  try {
    return { ...DEFAULT_TIMESHEET_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_TIMESHEET_SETTINGS;
  }
}

export async function setTimesheetSettings(settings: TimesheetSettings): Promise<void> {
  await AsyncStorage.setItem(TIMESHEET_SETTINGS_KEY, JSON.stringify(settings));
}
