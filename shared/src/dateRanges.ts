import { addDays, startOfDay, startOfMonth, startOfWeek } from "./time";

// Shared between every date-range filter/picker in the app (Export, History) so they
// offer the exact same presets and compute them identically — originally duplicated
// per-screen per-client, hoisted here once a third consumer needed it too.
export type RangeKey = "thisWeek" | "lastWeek" | "thisMonth" | "last90" | "custom";

export const RANGES: { key: RangeKey; label: string }[] = [
  { key: "thisWeek", label: "This Week" },
  { key: "lastWeek", label: "Last Week" },
  { key: "thisMonth", label: "This Month" },
  { key: "last90", label: "Last 90 Days" },
  { key: "custom", label: "Custom Range" },
];

// `custom` is handled by the caller (needs user-picked start/end state) — every other
// key is a pure function of "today".
export function rangeFor(key: Exclude<RangeKey, "custom">): { start: Date; end: Date; label: string } {
  const today = new Date();
  switch (key) {
    case "thisWeek": {
      const start = startOfWeek(today);
      return { start, end: addDays(start, 7), label: `Week of ${start.toLocaleDateString()}` };
    }
    case "lastWeek": {
      const start = addDays(startOfWeek(today), -7);
      return { start, end: addDays(start, 7), label: `Week of ${start.toLocaleDateString()}` };
    }
    case "thisMonth": {
      const start = startOfMonth(today);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      return { start, end, label: start.toLocaleDateString([], { month: "long", year: "numeric" }) };
    }
    case "last90": {
      const start = addDays(startOfDay(today), -90);
      return { start, end: addDays(startOfDay(today), 1), label: "Last 90 days" };
    }
  }
}
