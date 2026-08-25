import { toDateString } from "@/lib/dates";
import {
  EventNotFoundError,
  type CalendarProvider,
  type ExternalEvent,
  type ListEventsInput,
  type UpsertEventInput,
  type UpsertEventResult,
} from "./types";

/**
 * Google Calendar provider, backed by a **per-user OAuth** access token.
 *
 * The token is supplied lazily by the caller (see
 * `getAccessTokenForAccount` in ./googleOAuth) and cached only for the
 * lifetime of this instance — access tokens live ~1 hour and are never
 * persisted. The refresh token that produced it never reaches this class.
 *
 * Only the Calendar v3 REST endpoints we actually need are called, with
 * plain `fetch`, rather than pulling in the whole `googleapis` package.
 */

const API_BASE = "https://www.googleapis.com/calendar/v3";

/**
 * Extended-property marker written onto every event this app creates, and
 * one of the three signals the read-back overlay uses to exclude its own
 * events. See `upsertEvent` and `listEvents`.
 */
export const PICKL_MARKER_KEY = "pickl";
export const PICKL_MARKER_VALUE = "1";

/**
 * The UID prefix used by the CalDAV provider's stable UIDs. Repeated here
 * (rather than imported) so the Google module does not depend on the
 * CalDAV one: an event pushed by Pickl over CalDAV into a calendar the
 * user ALSO has connected to Google carries `iCalUID` "pickl-…", and the
 * overlay must exclude it too.
 */
const PICKL_UID_PREFIX = "pickl-";

/** How many events one week's read will accept before it stops paging. */
const MAX_EVENTS = 250;

/** RFC3339 timestamp with the server's local UTC offset, e.g. 2026-08-23T18:00:00-04:00. */
function toRfc3339Local(d: Date): string {
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const offsetMinutes = -d.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const offset = `${sign}${pad(offsetMinutes / 60)}:${pad(offsetMinutes % 60)}`;
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${offset}`
  );
}

/**
 * Turns a Google API error payload into a single human-readable line.
 * Google's own wording ("Not Found", "Request had insufficient
 * authentication scopes") is exactly what the user needs to see, so we
 * pass it through rather than genericising it.
 */
function describeApiError(status: number, bodyText: string): string {
  let detail = bodyText.trim();
  try {
    const parsed = JSON.parse(bodyText);
    detail = parsed?.error?.message || parsed?.error_description || parsed?.error || detail;
    if (typeof detail !== "string") detail = JSON.stringify(detail);
  } catch {
    // Non-JSON body (an HTML error page, say) — use it as-is, trimmed.
  }
  if (detail.length > 500) detail = `${detail.slice(0, 500)}…`;
  return `Google Calendar API error ${status}${detail ? `: ${detail}` : ""}`;
}

/** Only the fields we ask Google for; see the `fields` mask in listEvents. */
interface GoogleEventItem {
  id?: string;
  iCalUID?: string;
  summary?: string;
  status?: string;
  transparency?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
  extendedProperties?: { private?: Record<string, string> };
}

function isPicklEvent(item: GoogleEventItem): boolean {
  if (item.extendedProperties?.private?.[PICKL_MARKER_KEY] === PICKL_MARKER_VALUE) {
    return true;
  }
  return Boolean(item.iCalUID && item.iCalUID.startsWith(PICKL_UID_PREFIX));
}

/** True when the signed-in user is an attendee who answered "no". */
function hasDeclined(item: GoogleEventItem): boolean {
  return (item.attendees ?? []).some(
    (a) => a.self && a.responseStatus === "declined"
  );
}

/** Adds `days` to a YYYY-MM-DD string without going through a Date. */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, (d ?? 1) + days);
  return toDateString(dt);
}

/**
 * One Google instance becomes one ExternalEvent PER local day it covers,
 * so a Tuesday-to-Thursday trip shows on all three rows of the grid rather
 * than only on the Tuesday. Days outside the requested range are dropped.
 */
function toExternalEvents(
  item: GoogleEventItem,
  rangeStart: Date,
  rangeEnd: Date
): ExternalEvent[] {
  const summary = (item.summary || "(busy)").trim() || "(busy)";
  const firstDay = toDateString(rangeStart);
  // rangeEnd is exclusive, so the last renderable day is the day before it.
  const lastDay = toDateString(new Date(rangeEnd.getTime() - 1));

  const clampAndBuild = (
    startDay: string,
    endDayInclusive: string,
    start: string | null,
    end: string | null,
    allDay: boolean
  ): ExternalEvent[] => {
    const multiDay = endDayInclusive > startDay;
    const events: ExternalEvent[] = [];
    let cursor = startDay < firstDay ? firstDay : startDay;
    const stop = endDayInclusive > lastDay ? lastDay : endDayInclusive;
    // Guard against a pathological range; a week can never need 400 rows.
    for (let i = 0; cursor <= stop && i < 400; i++) {
      events.push({
        id: `${item.id}:${cursor}`,
        summary,
        date: cursor,
        start,
        end,
        allDay,
        multiDay,
      });
      cursor = addDays(cursor, 1);
    }
    return events;
  };

  // All-day: Google gives plain dates and an EXCLUSIVE end date.
  if (item.start?.date) {
    const startDay = item.start.date;
    const endExclusive = item.end?.date || addDays(startDay, 1);
    const endInclusive = addDays(endExclusive, -1);
    return clampAndBuild(
      startDay,
      endInclusive < startDay ? startDay : endInclusive,
      null,
      null,
      true
    );
  }

  // Timed: RFC3339 with the instance's own offset. `new Date` resolves it,
  // and toDateString renders it in the server's local zone — the same zone
  // the plan grid's dates are in, which is what keeps the two aligned.
  if (!item.start?.dateTime) return [];
  const startDate = new Date(item.start.dateTime);
  if (Number.isNaN(startDate.getTime())) return [];
  const endDate = item.end?.dateTime ? new Date(item.end.dateTime) : startDate;
  const usableEnd = Number.isNaN(endDate.getTime()) ? startDate : endDate;
  // An end exactly at midnight belongs to the previous day, not the next.
  const endForDay =
    usableEnd > startDate ? new Date(usableEnd.getTime() - 1) : startDate;

  return clampAndBuild(
    toDateString(startDate),
    toDateString(endForDay),
    startDate.toISOString(),
    usableEnd.toISOString(),
    false
  );
}


export class GoogleCalendarProvider implements CalendarProvider {
  private readonly calendarId: string;
  private readonly getToken: () => Promise<string>;
  private cachedToken: string | null = null;

  constructor(getToken: () => Promise<string>, calendarId: string) {
    if (!calendarId) {
      throw new Error(
        "No calendar is selected for this sync target. Pick one under Preferences → Calendars."
      );
    }
    this.calendarId = calendarId;
    this.getToken = getToken;
  }

  private async accessToken(): Promise<string> {
    if (!this.cachedToken) {
      this.cachedToken = await this.getToken();
    }
    return this.cachedToken;
  }

  private async request(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    signal?: AbortSignal
  ): Promise<Response> {
    const token = await this.accessToken();
    try {
      return await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (err) {
      // Network-level failure (DNS, offline, proxy) — never a Google status.
      throw new Error(
        `Could not reach the Google Calendar API: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  private encodedCalendarId(): string {
    return encodeURIComponent(this.calendarId);
  }

  async upsertEvent(input: UpsertEventInput): Promise<UpsertEventResult> {
    const payload = {
      summary: input.summary,
      description: input.description || undefined,
      start: { dateTime: toRfc3339Local(input.start) },
      end: { dateTime: toRfc3339Local(input.end) },
      // A private extended property marking this as Pickl's own event.
      // Google assigns event ids itself, so unlike CalDAV we cannot put a
      // "pickl-" prefix in the UID — this is the equivalent self-identifying
      // marker, and the read-back overlay filters on it so a pushed meal is
      // never drawn back onto the grid as if it were an outside commitment.
      // "private" here is Google's own visibility term: the property is
      // readable only by this OAuth client, and carries no meal detail.
      extendedProperties: {
        private: {
          [PICKL_MARKER_KEY]: PICKL_MARKER_VALUE,
          ...(input.slotKey ? { picklSlot: input.slotKey } : {}),
        },
      },
    };

    const path = input.existingEventId
      ? `/calendars/${this.encodedCalendarId()}/events/${encodeURIComponent(
          input.existingEventId
        )}`
      : `/calendars/${this.encodedCalendarId()}/events`;

    const res = await this.request(input.existingEventId ? "PUT" : "POST", path, payload);

    if (res.status === 404 && input.existingEventId) {
      // The event was deleted on Google's side. Signal upward so the sync
      // layer can create a fresh one instead of failing forever.
      throw new EventNotFoundError();
    }
    if (!res.ok) {
      throw new Error(describeApiError(res.status, await res.text().catch(() => "")));
    }

    const data = (await res.json().catch(() => null)) as { id?: string } | null;
    if (!data?.id) {
      throw new Error("Google Calendar did not return an event id.");
    }
    // No etag: Google's If-Match support isn't needed here, since the
    // event id alone identifies the event for update and delete.
    return { externalEventId: data.id };
  }

  /**
   * Reads one date range back out of the calendar.
   *
   * ## Recurrence
   * `singleEvents=true` makes Google expand recurring series into
   * individual occurrences server-side, within the timeMin/timeMax window.
   * That is deliberate: RRULE/EXDATE/RDATE expansion with per-instance
   * overrides is a notorious source of subtle bugs, and Google already
   * does it correctly. We never see (or need) the RRULE itself.
   *
   * ## Filtering Pickl's own events
   * Three signals, cheapest-first, so a meal already pushed to this
   * calendar is not drawn back onto the grid as an outside commitment:
   *   1. `extendedProperties.private.pickl` — written by `upsertEvent`
   *      above. The definitive signal for events this app created here.
   *   2. `iCalUID` starting with "pickl-" — catches events this app pushed
   *      over CalDAV into a calendar the user also connects via Google.
   *   3. An id present in the caller-supplied `excludeEventIds` set — the
   *      `calendar_event_links` rows for this viewer's own targets, which
   *      covers events created before the marker existed.
   * (3) is applied by the read layer, which owns the database; (1) and (2)
   * are applied here.
   *
   * ## Timezones
   * Google is asked for the range in the server's local offset and returns
   * each instance with its own offset resolved. Timed events are converted
   * to the server's local day; all-day events (`start.date`) are kept as
   * plain date strings and never passed through a Date constructor that
   * would shift them across a day boundary.
   *
   * Cancelled instances and events the user has declined outright are
   * dropped — showing "you're busy" for something they said no to is worse
   * than showing nothing.
   */
  async listEvents(input: ListEventsInput): Promise<ExternalEvent[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const params = new URLSearchParams({
        timeMin: toRfc3339Local(input.rangeStart),
        timeMax: toRfc3339Local(input.rangeEnd),
        singleEvents: "true",
        orderBy: "startTime",
        showDeleted: "false",
        maxResults: String(MAX_EVENTS),
        // Only the fields the overlay renders. Descriptions, attendees,
        // locations and conferencing data are never even transferred.
        fields:
          "items(id,iCalUID,summary,status,start,end,transparency,attendees(self,responseStatus),extendedProperties/private)",
      });

      const res = await this.request(
        "GET",
        `/calendars/${this.encodedCalendarId()}/events?${params.toString()}`,
        undefined,
        controller.signal
      );
      if (!res.ok) {
        throw new Error(describeApiError(res.status, await res.text().catch(() => "")));
      }

      const data = (await res.json().catch(() => null)) as {
        items?: GoogleEventItem[];
      } | null;

      const out: ExternalEvent[] = [];
      for (const item of data?.items ?? []) {
        if (!item?.id || item.status === "cancelled") continue;
        if (isPicklEvent(item)) continue;
        if (hasDeclined(item)) continue;
        const mapped = toExternalEvents(item, input.rangeStart, input.rangeEnd);
        out.push(...mapped);
      }
      return out;
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(
          `Timed out reading your Google calendar after ${input.timeoutMs}ms.`
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async deleteEvent(externalEventId: string): Promise<void> {
    const res = await this.request(
      "DELETE",
      `/calendars/${this.encodedCalendarId()}/events/${encodeURIComponent(externalEventId)}`
    );
    // 410 Gone / 404 Not Found both mean "already deleted" — success.
    if (res.ok || res.status === 404 || res.status === 410) return;
    throw new Error(describeApiError(res.status, await res.text().catch(() => "")));
  }
}
