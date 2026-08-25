/**
 * Provider-agnostic calendar interface.
 *
 * Everything above this layer (src/lib/calendar/sync.ts, the API routes)
 * deals only in these types, so adding CalDAV later means writing one new
 * file implementing `CalendarProvider` and one line in `index.ts`.
 *
 * This abstraction survived the move from a single admin-owned service
 * account to per-user OAuth unchanged: what changed is where the
 * credentials come from and how many providers a single plan write fans
 * out to, not what a "calendar provider" is.
 */

export interface UpsertEventInput {
  /** The provider event id we previously stored, if any (update instead of create). */
  existingEventId?: string | null;
  /**
   * The provider's version tag for that event as of our last write, when
   * the provider has such a concept. CalDAV uses it for If-Match; Google
   * ignores it (its API has no equivalent we need here). Optional
   * precisely so a provider that doesn't do optimistic concurrency stays
   * a two-method class.
   */
  existingEtag?: string | null;
  /**
   * The plan slot this event mirrors, as `date:mealType` — the same
   * idempotency key `calendar_event_links` is keyed on.
   *
   * Providers that address events by a server-assigned id (Google) ignore
   * it. CalDAV uses it to derive a *stable* UID, and from that a stable
   * resource URL, so a lost link row re-addresses the existing event
   * instead of creating a second one.
   */
  slotKey?: string;
  start: Date;
  end: Date;
  summary: string;
  /** Only ever populated when the target has includeDetail enabled. */
  description?: string | null;
}

export interface UpsertEventResult {
  /** The provider's event id, stored on calendar_event_links. */
  externalEventId: string;
  /** Version tag to present next time, when the provider issues one. */
  etag?: string | null;
}

/**
 * One event read back OUT of the user's calendar, for the read-back
 * overlay on the plan grid.
 *
 * **This shape is never persisted.** It is built per request, rendered,
 * and dropped (see src/lib/calendar/read.ts for the in-memory-only cache).
 * Deliberately minimal: no attendees, no organizer, no location, no
 * description, no conferencing links, no colours. The overlay's job is to
 * say "you have something on at this time", and everything beyond that is
 * private detail the meal planner has no business handling.
 */
export interface ExternalEvent {
  /**
   * Stable within one fetch, used only as a React key. Not a provider id
   * we store anywhere.
   */
  id: string;
  /** Event title. Never logged, never written to the database. */
  summary: string;
  /** Local calendar date this occurrence is drawn on (YYYY-MM-DD). */
  date: string;
  /** Local start/end times as ISO strings, or null for an all-day event. */
  start: string | null;
  end: string | null;
  allDay: boolean;
  /** True when the event spans more than one calendar day. */
  multiDay: boolean;
}

export interface ListEventsInput {
  /** Inclusive lower bound (local time). */
  rangeStart: Date;
  /** Exclusive upper bound (local time). */
  rangeEnd: Date;
  /** Hard deadline; the provider must abort rather than exceed it. */
  timeoutMs: number;
}

export interface CalendarProvider {
  /** Creates or updates the event; returns the provider's event id. */
  upsertEvent(input: UpsertEventInput): Promise<UpsertEventResult>;

  /**
   * Reads events back out of the calendar for one date range.
   *
   * Optional on the interface on purpose: a provider that cannot read is
   * expected to either omit this method or throw
   * CalendarReadUnsupportedError from it, and the read layer treats both
   * identically. That keeps `index.ts` honest — nothing pretends to
   * support a read it hasn't implemented.
   *
   * Implementations must expand recurring events into individual
   * occurrences themselves (or ask the remote API to), and must respect
   * `timeoutMs`.
   */
  listEvents?(input: ListEventsInput): Promise<ExternalEvent[]>;

  /**
   * Deletes the event. Must resolve (not throw) if it is already gone.
   * `etag` is the version we last wrote, for providers that support a
   * conditional delete.
   */
  deleteEvent(externalEventId: string, etag?: string | null): Promise<void>;
}

/**
 * Thrown by a provider when the event id we had on file no longer exists
 * remotely (deleted by hand in the calendar UI, say). The sync layer
 * catches this and creates a fresh event rather than failing forever.
 */
export class EventNotFoundError extends Error {
  constructor(message = "Calendar event no longer exists.") {
    super(message);
    this.name = "EventNotFoundError";
  }
}

/**
 * Thrown by a provider whose read path is not implemented.
 *
 * CalDAV throws this: reading a week back would need a `calendar-query`
 * REPORT plus full RRULE/EXDATE expansion client-side, which is a project
 * in itself. Rather than half-implement it, the provider says so
 * explicitly and the overlay degrades to "not available for this
 * connection" instead of erroring.
 */
export class CalendarReadUnsupportedError extends Error {
  constructor(
    message = "Reading events back is not supported for this calendar connection yet."
  ) {
    super(message);
    this.name = "CalendarReadUnsupportedError";
  }
}

/**
 * Thrown when the stored refresh token is no longer usable — the user
 * revoked access in their Google account, or (much more commonly) the
 * deployment's OAuth consent screen is still in "Testing", where Google
 * expires refresh tokens after ~7 days.
 *
 * The sync layer records this on `calendar_accounts.lastError` so the UI
 * can show an actionable "Reconnect your Google account" state instead of
 * failing silently forever.
 */
export class ReauthRequiredError extends Error {
  constructor(
    message = "Google rejected the stored authorization. Reconnect your Google account."
  ) {
    super(message);
    this.name = "ReauthRequiredError";
  }
}
