import { createHash } from "node:crypto";
import ical, { ICalEventStatus } from "ical-generator";
import {
  deleteEvent as davDelete,
  headEvent as davHead,
  putEvent as davPut,
  type CaldavCredentials,
} from "./caldavClient";
import { normalizeCaldavUrl } from "./caldavUrl";
import { CalendarReadUnsupportedError } from "./types";
import type {
  CalendarProvider,
  UpsertEventInput,
  UpsertEventResult,
} from "./types";

/**
 * CalDAV provider.
 *
 * ## Addressing: a stable UID, not a server-assigned id
 *
 * Google hands back an opaque event id we have to remember. CalDAV works
 * the other way round — *we* choose the resource URL and PUT to it — which
 * is a much better fit for an idempotent mirror. Every event's URL is
 * derived deterministically from (target id, date, meal type):
 *
 *     uid  = "pickl-" + sha256(targetId + "|" + date + ":" + mealType)[:32]
 *     url  = <collection>/<uid>.ics
 *
 * So if a `calendar_event_links` row is ever lost — a restore from an
 * older backup, a bug, a manual delete — the next push computes the same
 * URL and *overwrites the existing event* rather than double-booking the
 * meal. The link table remains the fast path; the UID is the safety net.
 *
 * The target id is in the hash, so two users mirroring the same household
 * meal into two different servers (or two calendars on one server) never
 * collide, and the UID reveals nothing about the meal.
 *
 * ## ETags
 *
 * Every write is conditional:
 *  - **create** uses `If-None-Match: *`, so we never silently clobber
 *    something already sitting at that URL. A 412 here means "our own
 *    event is already there" (the lost-link case above), so we fetch its
 *    ETag and update it instead — recovery, not duplication.
 *  - **update** uses `If-Match: <etag we last wrote>`. A 412 means the
 *    user edited the event in their calendar app since. Pickl is the
 *    source of truth for *which meal is scheduled*, and the alternative is
 *    a target that stays broken forever after one manual edit, so we
 *    re-read the ETag and overwrite once. The conditional still does real
 *    work: without it the second writer in a genuine race wins silently
 *    and we'd store a stale ETag.
 *  - **delete** uses `If-Match` and, on 412, **refuses to delete** and
 *    reports why. Deleting an event the user has since edited is
 *    destructive and unrecoverable, which is a different category from
 *    overwriting a summary — it matches the same instinct that leaves
 *    pushed events in place on disconnect.
 *
 * ## iCalendar bodies
 *
 * Built with `ical-generator`, already a dependency and already used by
 * /api/export/ical — same meal times (src/lib/dates), same
 * `Meal: Recipe` summary, same title-only-unless-includeDetail rule — so
 * an event pushed here is byte-comparable to one from the .ics export.
 */

const UID_PREFIX = "pickl-";

/** Deterministic per (target, slot). See the class comment. */
export function buildEventUid(targetId: string, slotKey: string): string {
  const digest = createHash("sha256")
    .update(`${targetId}|${slotKey}`)
    .digest("hex")
    .slice(0, 32);
  return `${UID_PREFIX}${digest}`;
}

/** `<collection>/<uid>.ics`, with exactly one slash in the join. */
export function buildResourceUrl(collectionUrl: string, uid: string): string {
  const base = collectionUrl.endsWith("/") ? collectionUrl : `${collectionUrl}/`;
  return new URL(`${encodeURIComponent(uid)}.ics`, base).href;
}

/**
 * A single-event VCALENDAR body. Deliberately minimal: one VEVENT, no
 * alarms, no attendees, no recurrence — anything else would be data
 * leaving the app that the user didn't ask to send.
 */
export function buildIcsBody(input: {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string | null;
}): string {
  const calendar = ical({ name: "Pickl" });
  calendar.createEvent({
    id: input.uid,
    start: input.start,
    end: input.end,
    summary: input.summary,
    // `undefined` (not "") so no DESCRIPTION line is emitted at all when
    // includeDetail is off — the recipe never reaches the wire.
    description: input.description || undefined,
    status: ICalEventStatus.CONFIRMED,
  });
  return calendar.toString();
}

export class CaldavCalendarProvider implements CalendarProvider {
  private readonly credentials: CaldavCredentials;
  private readonly collectionUrl: string;
  private readonly targetId: string;

  constructor(
    credentials: CaldavCredentials,
    collectionUrl: string,
    targetId: string
  ) {
    if (!collectionUrl) {
      throw new Error(
        "No calendar is selected for this sync target. Pick one under Preferences → Calendars."
      );
    }
    // Re-validated here as well as at save time: the stored collection URL
    // is user-supplied data, and this is the last gate before we fetch it.
    this.collectionUrl = normalizeCaldavUrl(collectionUrl).href;
    this.credentials = credentials;
    this.targetId = targetId;
  }

  /**
   * The resource URL for one slot. Prefers the deterministic address; only
   * falls back to a previously stored id if there is no slot key (which
   * would mean a caller outside the sync layer).
   */
  private resourceUrlFor(input: UpsertEventInput): { url: string; uid: string } {
    if (input.slotKey) {
      const uid = buildEventUid(this.targetId, input.slotKey);
      return { url: buildResourceUrl(this.collectionUrl, uid), uid };
    }
    const stored = input.existingEventId;
    if (stored) {
      const uid =
        decodeURIComponent(stored.split("/").pop() ?? "").replace(/\.ics$/i, "") ||
        `${UID_PREFIX}unknown`;
      return { url: stored, uid };
    }
    throw new Error("Cannot address a CalDAV event without a plan slot key.");
  }

  async upsertEvent(input: UpsertEventInput): Promise<UpsertEventResult> {
    const { url, uid } = this.resourceUrlFor(input);
    const body = buildIcsBody({
      uid,
      start: input.start,
      end: input.end,
      summary: input.summary,
      description: input.description,
    });

    if (input.existingEventId) {
      const result = await davPut(this.credentials, url, body, {
        ifMatch: input.existingEtag ?? undefined,
      });
      if (result !== "precondition-failed") {
        return { externalEventId: url, etag: result.etag };
      }
      // Edited remotely since our last write. Mirror the plan anyway (see
      // the ETag notes above), but re-read the current version first so
      // the write is still conditional rather than a blind overwrite.
      const current = await davHead(this.credentials, url);
      const retry = await davPut(this.credentials, url, body, {
        ifMatch: current.etag ?? undefined,
        ...(current.exists ? {} : { ifNoneMatch: "*" as const }),
      });
      if (retry === "precondition-failed") {
        throw new Error(
          "The event kept changing on the server while Pickl was updating it. Try “Sync now” again."
        );
      }
      return { externalEventId: url, etag: retry.etag };
    }

    // Create. If-None-Match keeps us from overwriting anything already at
    // this address.
    const created = await davPut(this.credentials, url, body, { ifNoneMatch: "*" });
    if (created !== "precondition-failed") {
      return { externalEventId: url, etag: created.etag };
    }

    // Something is already there. Because the URL is derived from a UID
    // scoped to this target, that is our own event with a lost link row —
    // adopt it instead of creating a duplicate.
    const existing = await davHead(this.credentials, url);
    const adopted = await davPut(this.credentials, url, body, {
      ifMatch: existing.etag ?? undefined,
    });
    if (adopted === "precondition-failed") {
      throw new Error(
        "Another event already exists at this address on the server and could not be updated."
      );
    }
    return { externalEventId: url, etag: adopted.etag };
  }

  /**
   * Reading events back is not implemented for CalDAV.
   *
   * Doing it properly needs a `calendar-query` REPORT against the
   * collection plus client-side expansion of RRULE/RDATE/EXDATE and
   * per-instance overrides (`RECURRENCE-ID`) — CalDAV servers are not
   * required to expand recurrences for you, and the ones that do disagree
   * about how. The Google provider gets that expansion for free from
   * `singleEvents=true`; here it would be a from-scratch implementation,
   * and a half-correct one would quietly show people the wrong week.
   *
   * So this says "not supported" out loud. The read layer treats that as a
   * neutral state, not a failure: a CalDAV-only user simply sees no
   * overlay and an explanatory line, never an error.
   */
  async listEvents(): Promise<never> {
    throw new CalendarReadUnsupportedError(
      "Pickl can't read events back from a CalDAV server yet — the calendar overlay is Google-only for now."
    );
  }

  async deleteEvent(externalEventId: string, etag?: string | null): Promise<void> {
    const outcome = await davDelete(this.credentials, externalEventId, etag ?? undefined);
    if (outcome === "precondition-failed") {
      throw new Error(
        "That event was changed in your calendar after Pickl created it, so it was left in place rather than deleted. Remove it yourself if you no longer want it."
      );
    }
    // "deleted" and "already-gone" are both success.
  }
}
