// Device-local preference, mirroring app/src/lib/preferences.ts's promptForNotesOnClockOut
// — never synced, since it's a per-device workflow toggle, not data. localStorage is this
// platform's equivalent of AsyncStorage there.
const PROMPT_FOR_NOTES_KEY = "clocker.promptForNotesOnClockOut";

export function getPromptForNotesOnClockOut(): boolean {
  try {
    return localStorage.getItem(PROMPT_FOR_NOTES_KEY) === "true";
  } catch {
    return false;
  }
}

export function setPromptForNotesOnClockOut(value: boolean): void {
  try {
    localStorage.setItem(PROMPT_FOR_NOTES_KEY, value ? "true" : "false");
  } catch {
    // Private browsing / storage blocked — the toggle just won't persist across reloads.
  }
}
