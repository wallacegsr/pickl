/**
 * Date helpers for a Sunday-start week (Sunday -> Saturday), working purely
 * with local-date strings (YYYY-MM-DD) so behavior is consistent regardless of
 * server timezone quirks.
 */

export function toDateString(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateString(s: string): Date {
  const [year, month, day] = s.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

export function todayDateString(): string {
  return toDateString(new Date());
}

/** Returns the Sunday that starts the week containing the given date string. */
export function getSundayOfWeek(dateStr: string): Date {
  const d = parseDateString(dateStr);
  const dayOfWeek = d.getDay(); // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  const sunday = new Date(d);
  // Sunday is day index 0, so the week start is simply that many days back.
  sunday.setDate(d.getDate() - dayOfWeek);
  return sunday;
}

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export interface WeekDay {
  date: string;
  dayOfWeek: string;
}

/** Returns the 7 days (Sun-Sat) of the week containing dateStr. */
export function getWeekDays(dateStr: string): WeekDay[] {
  const sunday = getSundayOfWeek(dateStr);
  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    days.push({ date: toDateString(d), dayOfWeek: DAY_NAMES[d.getDay()] });
  }
  return days;
}

/** Returns remaining days (inclusive of today) through Saturday of the current week. */
export function getRemainingDaysInWeek(todayStr: string): WeekDay[] {
  const allDays = getWeekDays(todayStr);
  return allDays.filter((d) => d.date >= todayStr);
}

/** Default local start hour used when exporting each meal type to iCal. */
export const MEAL_DEFAULT_HOUR: Record<string, number> = {
  breakfast: 8,
  lunch: 12,
  dinner: 18,
};

export const MEAL_LABELS: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};
