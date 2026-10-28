import { eq } from "drizzle-orm";
import { db } from "@/db";
import { households } from "@/db/schema";
import { todayDateString } from "@/lib/dates";
import { dateInTimeZone } from "@/lib/viewerToday";

/**
 * Time for requests with no browser behind them.
 *
 * A browser tells the server its zone (src/lib/viewerToday.ts). Home Assistant
 * does not, and a server in a Docker container is usually on UTC, which in a
 * US evening is already tomorrow — so "what's for dinner" would answer for the
 * wrong day. The household's own zone, set by its admin, decides instead.
 */

/** The zone this runtime is in: the fallback when a household has none. */
export function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** True for a zone name this runtime recognises, such as "America/Chicago". */
export function isValidTimeZone(zone: string): boolean {
  return zone.length <= 64 && dateInTimeZone(new Date(), zone) !== null;
}

/** The household's zone, or the server's when none is set. */
export function householdTimeZone(householdId: string): string {
  const row = db
    .select({ timeZone: households.timeZone })
    .from(households)
    .where(eq(households.id, householdId))
    .get();
  const zone = row?.timeZone;
  return zone && isValidTimeZone(zone) ? zone : serverTimeZone();
}

/** Today's date (YYYY-MM-DD) where the household is. */
export function householdToday(householdId: string, now: Date = new Date()): string {
  return dateInTimeZone(now, householdTimeZone(householdId)) || todayDateString();
}

/** Milliseconds `zone` is ahead of UTC at the instant `at`. */
function zoneOffsetMs(at: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * The instant at which it is `hour`:00 on `date` in `zone`.
 *
 * Computed twice so a date on which the clocks change still lands on the
 * right side of the change: the first guess uses the offset at midnight UTC,
 * the second the offset at the instant that guess produced.
 */
export function zonedTime(date: string, hour: number, zone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, hour);
  const first = naive - zoneOffsetMs(new Date(naive), zone);
  return new Date(naive - zoneOffsetMs(new Date(first), zone));
}
