import type { Break, Shift } from "./types";

export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

// Total break time within a shift, in milliseconds. Any break still open counts up to now.
export function breakMillis(breaks: Break[]): number {
  return breaks.reduce((sum, b) => {
    const end = b.end ? new Date(b.end).getTime() : Date.now();
    return sum + (end - new Date(b.start).getTime());
  }, 0);
}

// Worked time = clock-in..clock-out (or now, if still open) minus break time.
export function workedMillis(shift: Shift, breaks: Break[]): number {
  const end = shift.clockOut ? new Date(shift.clockOut).getTime() : Date.now();
  const gross = end - new Date(shift.clockIn).getTime();
  return Math.max(0, gross - breakMillis(breaks));
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  const day = d.getDay();
  const diff = (day + 6) % 7; // Monday as the first day of the week
  d.setDate(d.getDate() - diff);
  return d;
}

export function startOfMonth(date: Date): Date {
  const d = startOfDay(date);
  d.setDate(1);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
