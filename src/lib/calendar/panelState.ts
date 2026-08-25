import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type CalendarTarget } from "@/db/schema";
import { getAccountForUser, getTargetsForUser } from "./accounts";
import { isGoogleOauthConfigured } from "./googleOAuth";

/**
 * The one shape Preferences → Calendars is rendered from, used by both
 * the server component (first paint) and /api/calendar/targets (every
 * refresh after that), so the two can't drift.
 *
 * **Nothing secret is in it.** No refresh token, no CalDAV password, not
 * even a masked one — the password is represented solely by
 * `caldav.hasPassword`, exactly as the SMTP settings do it. The CalDAV
 * server URL *is* returned (the user typed it and needs to see it to edit
 * it); it can never carry credentials because userinfo in the URL is
 * rejected at save time.
 *
 * Built from a session user id and nothing else. There is no variant of
 * this that takes another user's id, and no admin path to one.
 */

export interface CalendarTargetState {
  id: string;
  scope: "shared" | "private";
  provider: "google" | "caldav";
  calendarId: string;
  calendarName: string | null;
  includeDetail: boolean;
  enabled: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

export interface CaldavAccountState {
  connected: boolean;
  serverUrl: string;
  username: string;
  hasPassword: boolean;
  accountError: string | null;
}

export interface CalendarPanelState {
  oauthConfigured: boolean;
  /**
   * Whether this user has opted in to seeing their OWN external calendar
   * events on the plan grid. Defaults to false — see the notes on
   * `users.showCalendarOverlay` and src/lib/calendar/read.ts.
   */
  overlayEnabled: boolean;
  connected: boolean;
  accountEmail: string | null;
  accountError: string | null;
  caldav: CaldavAccountState;
  targets: CalendarTargetState[];
}

export function buildCalendarPanelState(userId: string): CalendarPanelState {
  const google = getAccountForUser(userId, "google");
  const caldav = getAccountForUser(userId, "caldav");

  // Which provider a target belongs to is a property of its account, so
  // it's resolved here rather than duplicated onto the target row.
  const providerByAccountId = new Map<string, "google" | "caldav">();
  if (google) providerByAccountId.set(google.id, "google");
  if (caldav) providerByAccountId.set(caldav.id, "caldav");

  const serializeTarget = (target: CalendarTarget): CalendarTargetState => ({
    id: target.id,
    scope: target.scope as "shared" | "private",
    provider: providerByAccountId.get(target.accountId) ?? "google",
    calendarId: target.calendarId,
    calendarName: target.calendarName,
    includeDetail: target.includeDetail,
    enabled: target.enabled,
    lastSyncAt: target.lastSyncAt?.toISOString() ?? null,
    lastSyncError: target.lastSyncError,
  });

  const overlayEnabled = Boolean(
    db
      .select({ enabled: users.showCalendarOverlay })
      .from(users)
      .where(eq(users.id, userId))
      .get()?.enabled
  );

  return {
    oauthConfigured: isGoogleOauthConfigured(),
    overlayEnabled,
    connected: Boolean(google),
    accountEmail: google?.accountEmail ?? null,
    accountError: google?.lastError ?? null,
    caldav: {
      connected: Boolean(caldav),
      serverUrl: caldav?.caldavServerUrl ?? "",
      username: caldav?.caldavUsername ?? "",
      hasPassword: Boolean(caldav?.caldavPasswordEncrypted),
      accountError: caldav?.lastError ?? null,
    },
    targets: getTargetsForUser(userId).map(serializeTarget),
  };
}
