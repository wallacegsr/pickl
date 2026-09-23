import { cookies } from "next/headers";
import { todayDateString } from "@/lib/dates";
import { TIME_ZONE_COOKIE } from "@/lib/timeZoneCookie";

/**
 * "Today" for the person making this request, not for the server.
 *
 * The server's clock is usually on UTC (a Docker container's default), which
 * in a US evening is already tomorrow. Using it made tonight count as a day
 * that has passed, pointed Crunch Time at tomorrow, and — because the Plan
 * page then drew a different date on the server than in the browser — made
 * React discard and redraw the whole page, losing the colour scheme and
 * sidebar state the no-flash scripts had put on <html>.
 *
 * The browser reports its time zone in a cookie (see TimeZoneSync), and the
 * date is worked out in that zone. With no cookie yet — a first visit — it
 * falls back to the server's own date, and TimeZoneSync refreshes the page
 * once the cookie is set.
 */
export async function viewerToday(now: Date = new Date()): Promise<string> {
  const zone = await viewerTimeZone();
  return (zone && dateInTimeZone(now, zone)) || todayDateString();
}

/** The request's reported time zone, if it is one this runtime recognises. */
export async function viewerTimeZone(): Promise<string | null> {
  let value: string | undefined;
  try {
    value = (await cookies()).get(TIME_ZONE_COOKIE)?.value;
  } catch {
    // Outside a request (a script, a test): no viewer to ask.
    return null;
  }
  if (!value || value.length > 64) return null;
  return dateInTimeZone(new Date(), value) ? value : null;
}

/** YYYY-MM-DD for `now` in `zone`, or null if the zone name isn't valid. */
export function dateInTimeZone(now: Date, zone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value;
    const [y, m, d] = [get("year"), get("month"), get("day")];
    return y && m && d ? `${y}-${m}-${d}` : null;
  } catch {
    return null;
  }
}
