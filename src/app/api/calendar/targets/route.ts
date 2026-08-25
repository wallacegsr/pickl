import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logAuditEntry } from "@/lib/audit";
import {
  deleteTargetForScope,
  getAccountForUser,
  upsertTarget,
} from "@/lib/calendar/accounts";
import { CaldavUrlError, normalizeCaldavUrl } from "@/lib/calendar/caldavUrl";
import { buildCalendarPanelState } from "@/lib/calendar/panelState";
import { calendarTargetSchema } from "@/lib/validators";

/**
 * The signed-in user's own calendar connection state and sync targets.
 *
 * Both handlers derive the owner from the session and never accept a user
 * id from the client. There is deliberately no admin variant of this
 * route: an admin has exactly as much access to a member's calendar
 * connection as any other member does, which is none.
 *
 * Nothing secret is ever returned — not the refresh token, not the OAuth
 * client secret, not the CalDAV password, not even a masked form of any
 * of them. See src/lib/calendar/panelState.ts for the exact shape.
 */

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(buildCalendarPanelState(session.user.id));
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await req.json().catch(() => null);
  const parsed = calendarTargetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }
  const data = parsed.data;

  // A blank calendar id means "Don't sync this plan" — handled before the
  // account lookup so a user can always turn sync off, even for a
  // provider they have since disconnected.
  if (!data.calendarId) {
    const removed = deleteTargetForScope(userId, data.scope);
    if (removed) {
      logAuditEntry({
        userId,
        targetUserId: userId,
        action: "calendar_update",
        scope: data.scope,
        notes: `calendar sync target removed for ${data.scope} plan`,
      });
    }
    return NextResponse.json(buildCalendarPanelState(userId));
  }

  const account = getAccountForUser(userId, data.provider);
  if (!account) {
    return NextResponse.json(
      {
        error:
          data.provider === "caldav"
            ? "Connect your CalDAV server before choosing a calendar."
            : "Connect your Google account before choosing a calendar.",
      },
      { status: 400 }
    );
  }

  // For CalDAV the "calendar id" is a URL the server will later fetch, so
  // it goes through the same https/SSRF shape checks as the server URL
  // did. Without this, the target picker would be a second, unguarded way
  // to get an arbitrary URL into the outbound request path.
  let calendarId = data.calendarId;
  if (data.provider === "caldav") {
    try {
      calendarId = normalizeCaldavUrl(calendarId).href;
    } catch (err) {
      if (err instanceof CaldavUrlError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  }

  upsertTarget({
    userId,
    accountId: account.id,
    scope: data.scope,
    calendarId,
    calendarName: data.calendarName ?? null,
    includeDetail: data.includeDetail,
    enabled: data.enabled,
  });

  // Non-secret context only: which plan, which provider, and the flags.
  // The calendar identifier is logged for Google (an opaque id) but NOT
  // for CalDAV, where it is a URL on the user's own server — an audit row
  // is not the place to record where somebody self-hosts.
  logAuditEntry({
    userId,
    targetUserId: userId,
    action: "calendar_update",
    scope: data.scope,
    notes:
      `calendar sync target set for ${data.scope} plan (provider=${data.provider}, ` +
      `${data.provider === "google" ? `calendar=${calendarId}, ` : ""}` +
      `includeDetail=${data.includeDetail}, enabled=${data.enabled})`,
  });

  return NextResponse.json(buildCalendarPanelState(userId));
}
