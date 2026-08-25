import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  calendarEventLinks,
  users,
  type CalendarTarget,
  type Scope,
} from "@/db/schema";
import { getSundayOfWeek, toDateString } from "@/lib/dates";
import {
  accountHasCredentials,
  getAccountById,
  getTargetForUserScope,
  getTargetsForUser,
  setAccountError,
} from "./accounts";
import { getProviderForTarget } from "./index";
import {
  CalendarReadUnsupportedError,
  ReauthRequiredError,
  type ExternalEvent,
} from "./types";

/**
 * Reading the viewer's OWN calendar back, to draw alongside the meal plan.
 *
 * Until this module existed, Pickl only ever *wrote* to calendars. Reading
 * is a different category of thing — a person's calendar plausibly holds
 * therapy appointments, job interviews and medical scheduling — so the
 * rules below are not stylistic preferences, they are the feature's
 * contract:
 *
 * 1. **Nothing read here is ever persisted.** No titles, no times, no
 *    attendees, not in any table, not in a log line. The only retention is
 *    the in-process cache at the bottom of this file, which lives for
 *    CACHE_TTL_MS and dies with the process. Grep this module for `insert`
 *    or `update` against anything but `calendar_accounts.lastError` (a
 *    connection-health flag that contains no event data) and you will find
 *    nothing.
 * 2. **Per-viewer, never shared.** The household plan grid is shared; the
 *    overlay drawn on it is not. Events come only from the account of the
 *    user making the request. Two people looking at the same household
 *    week see two different overlays.
 * 3. **Admins get nothing extra.** An admin may view a member's private
 *    plan, but `resolveOverlayAccess` refuses the overlay outright in that
 *    case — it does not fall back to showing the admin's own events on
 *    someone else's plan either, which would be confusing as well as
 *    unhelpful. This is enforced here, server-side, not in the UI.
 * 4. **Opt-in.** `users.showCalendarOverlay` defaults to false. When it is
 *    off, this module returns before any provider is constructed and no
 *    outbound request is made at all.
 * 5. **Never fatal.** Every path returns an OverlayResult. Nothing here
 *    throws, so no calendar problem can prevent the plan grid rendering.
 */

/** Hard ceiling on one read. Shorter than the push path's 15s: nobody is waiting on a push. */
const READ_TIMEOUT_MS = 5_000;

/** How long one week's fetch is reusable, in memory only. */
const CACHE_TTL_MS = 60_000;

/** Bound on the cache so a long-lived process cannot grow without limit. */
const CACHE_MAX_ENTRIES = 200;

export type OverlayStatus =
  /** Events fetched (possibly zero of them). */
  | "ok"
  /** The user has not opted in. No request was made. */
  | "off"
  /** No calendar is connected for this plan. */
  | "not-configured"
  /** The connected provider cannot be read from (CalDAV, today). */
  | "unsupported"
  /** The stored authorization is dead — reuses the existing reconnect signal. */
  | "reauth"
  /** Something went wrong. The grid renders regardless. */
  | "error"
  /** Someone else's plan: no overlay, by design. */
  | "not-available";

export interface OverlayResult {
  status: OverlayStatus;
  /** Always present, possibly empty. Never persisted anywhere. */
  events: ExternalEvent[];
  /** A short line for the UI. Never contains an event title. */
  message: string | null;
}

const EMPTY = (status: OverlayStatus, message: string | null = null): OverlayResult => ({
  status,
  events: [],
  message,
});

export interface OverlayRequest {
  /** The signed-in user making the request. The ONLY source of calendar credentials. */
  viewerUserId: string;
  scope: Scope;
  /** For a private plan, whose plan is being viewed. */
  planOwnerUserId: string;
  /** Any date in the week being displayed. */
  week: string;
}

/**
 * Whether this viewer may see an overlay on this plan at all.
 *
 * Shared plan: yes — everyone sees their own events on the household grid.
 * Private plan: only your own. An admin viewing a member's private plan
 * gets nothing, which is the rule this function exists to enforce.
 */
export function resolveOverlayAccess(request: OverlayRequest): boolean {
  if (request.scope === "shared") return true;
  return request.planOwnerUserId === request.viewerUserId;
}

/** The user's opt-in flag. Read fresh from the row, not from the JWT. */
export function isOverlayEnabledForUser(userId: string): boolean {
  const row = db
    .select({ enabled: users.showCalendarOverlay })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return Boolean(row?.enabled);
}

export function setOverlayEnabledForUser(userId: string, enabled: boolean): void {
  db.update(users)
    .set({ showCalendarOverlay: enabled })
    .where(eq(users.id, userId))
    .run();
}

/**
 * The provider event ids Pickl itself pushed from this viewer's targets.
 *
 * This is the third exclusion signal (see GoogleCalendarProvider.listEvents
 * for the other two) and the one that covers events pushed before the
 * extended-property marker existed. Only ids are read — the link table
 * holds no event content, which is precisely why it is safe to consult.
 */
function pushedEventIdsForUser(userId: string): Set<string> {
  const targetIds = getTargetsForUser(userId).map((t) => t.id);
  if (targetIds.length === 0) return new Set();
  const rows = db
    .select({ externalEventId: calendarEventLinks.externalEventId })
    .from(calendarEventLinks)
    .where(inArray(calendarEventLinks.targetId, targetIds))
    .all();
  return new Set(rows.map((r) => r.externalEventId));
}

/**
 * The target whose calendar the overlay reads.
 *
 * The plan's own target: viewing the household grid shows the calendar you
 * mirror household meals into, which is nearly always the calendar the
 * rest of your life is in too.
 *
 * Judgment call: a target with `enabled: false` (push turned off) is still
 * read from. The two switches mean different things — "stop writing my
 * meals out" is not "stop showing me my week" — and the overlay has its
 * own opt-in above, which is the switch that governs reading.
 */
function targetForOverlay(userId: string, scope: Scope): CalendarTarget | undefined {
  return getTargetForUserScope(userId, scope);
}

// --- Cache -----------------------------------------------------------------
// In-process, in-memory, TTL'd. Keyed by viewer as well as calendar and
// week, so one user's fetch can never be served to another user even if
// they somehow shared a calendar id.

interface CacheEntry {
  expiresAt: number;
  result: OverlayResult;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(userId: string, targetId: string, calendarId: string, weekStart: string) {
  return `${userId}|${targetId}|${calendarId}|${weekStart}`;
}

function readCache(key: string): OverlayResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.result;
}

function writeCache(key: string, result: OverlayResult): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Cheap eviction: drop whatever is oldest by insertion order. A Map
    // preserves it, and an exact LRU is not worth the bookkeeping for a
    // 60-second cache.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, result });
}

/** Test/ops seam: forget everything cached. Never called from a route. */
export function __clearOverlayCache(): void {
  cache.clear();
}

// --- The read --------------------------------------------------------------

/**
 * Fetches the viewer's own external events for one week. **Never throws.**
 *
 * Returns quickly in every failure mode, including a hung provider: the
 * provider is given READ_TIMEOUT_MS and raced against the same deadline
 * here as a backstop, in case a provider ignores its own budget.
 */
export async function getOverlayEvents(
  request: OverlayRequest
): Promise<OverlayResult> {
  try {
    if (!resolveOverlayAccess(request)) {
      // Deliberately not an error: viewing someone else's plan is allowed,
      // it just never carries a calendar overlay.
      return EMPTY(
        "not-available",
        "Calendar events are only shown on your own plans."
      );
    }

    if (!isOverlayEnabledForUser(request.viewerUserId)) {
      // The opt-out short-circuit. Nothing below this line runs, so no
      // request leaves the server when the preference is off.
      return EMPTY("off");
    }

    const target = targetForOverlay(request.viewerUserId, request.scope);
    if (!target) {
      return EMPTY(
        "not-configured",
        "Connect a calendar for this plan under Preferences → Calendars to see your events here."
      );
    }

    const account = getAccountById(target.accountId, request.viewerUserId);
    if (!account || !accountHasCredentials(account)) {
      return EMPTY(
        "not-configured",
        "That calendar connection is missing its credentials. Reconnect it under Preferences → Calendars."
      );
    }

    const weekStart = getSundayOfWeek(request.week);
    const weekStartStr = toDateString(weekStart);
    const key = cacheKey(
      request.viewerUserId,
      target.id,
      target.calendarId,
      weekStartStr
    );
    const cached = readCache(key);
    if (cached) return cached;

    const rangeStart = new Date(weekStart);
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(rangeStart);
    rangeEnd.setDate(rangeEnd.getDate() + 7);

    const provider = getProviderForTarget(target, account);
    if (typeof provider.listEvents !== "function") {
      return EMPTY(
        "unsupported",
        "Pickl can't read events back from this kind of calendar connection yet."
      );
    }

    // Backstop deadline. The provider is given the same budget and is
    // expected to abort itself; this race is here so that a provider which
    // ignores it (or hangs before its own timer is armed) still cannot
    // hold the request open. The timer is always cleared, so a fast read
    // leaves nothing pending behind it.
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      deadlineTimer = setTimeout(
        () => reject(new Error("Calendar read timed out.")),
        READ_TIMEOUT_MS
      );
    });

    let fetched: ExternalEvent[];
    try {
      fetched = await Promise.race([
        provider.listEvents({ rangeStart, rangeEnd, timeoutMs: READ_TIMEOUT_MS }),
        deadline,
      ]);
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
    }

    const excluded = pushedEventIdsForUser(request.viewerUserId);
    const events = fetched.filter((event) => {
      // event.id is `${providerEventId}:${date}` for multi-day expansion.
      const providerId = event.id.slice(0, event.id.lastIndexOf(":"));
      return !excluded.has(providerId) && !excluded.has(event.id);
    });

    // A successful read is also evidence the authorization is healthy.
    if (account.lastError) {
      try {
        setAccountError(account.id, null);
      } catch {
        // Bookkeeping only — never let it affect the result.
      }
    }

    const result: OverlayResult = { status: "ok", events, message: null };
    writeCache(key, result);
    return result;
  } catch (err) {
    if (err instanceof CalendarReadUnsupportedError) {
      return EMPTY("unsupported", err.message);
    }
    if (err instanceof ReauthRequiredError) {
      // Reuse the EXISTING reconnect signal rather than inventing a second
      // one: the same lastError the push path sets, surfaced by the same
      // banner in Preferences → Calendars.
      try {
        const target = targetForOverlay(request.viewerUserId, request.scope);
        const account = target
          ? getAccountById(target.accountId, request.viewerUserId)
          : undefined;
        if (account) setAccountError(account.id, err.message);
      } catch {
        // ignore
      }
      return EMPTY(
        "reauth",
        "Your calendar connection needs reconnecting — see Preferences → Calendars."
      );
    }
    // No event data can be in scope here, but be explicit about it: the
    // message is the provider's own, which describes transport and status,
    // never content.
    console.error(
      "[calendar] overlay read failed:",
      err instanceof Error ? err.message : String(err)
    );
    return EMPTY("error", "Couldn't load your calendar events.");
  }
}
