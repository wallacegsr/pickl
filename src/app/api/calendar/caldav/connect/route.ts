import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logAuditEntry } from "@/lib/audit";
import {
  getAccountForUser,
  getCaldavCredentials,
  upsertCaldavAccount,
} from "@/lib/calendar/accounts";
import { CaldavError, discoverCalendars } from "@/lib/calendar/caldavClient";
import { CaldavUrlError, normalizeCaldavUrl } from "@/lib/calendar/caldavUrl";
import { buildCalendarPanelState } from "@/lib/calendar/panelState";
import { caldavConnectSchema } from "@/lib/validators";

/**
 * Connect (or re-connect) the CALLER's own CalDAV server.
 *
 * Owner comes from the session; the body carries no user id, so there is
 * no way to attach a server to anyone else's account — and no admin
 * variant of this route, matching Google.
 *
 * The credentials are proved before they are stored: we run the full
 * discovery walk first and only write the row if the server answered, the
 * password worked, and at least one calendar that can hold events exists.
 * Storing credentials we have never seen succeed just moves the failure
 * to a background push where nobody is watching.
 *
 * A blank password on a re-connect means "keep the stored one" (the SMTP
 * convention), so a user can correct a URL without re-typing their app
 * password — and the plaintext never has to round-trip to the browser.
 *
 * Nothing here is logged: not the password, not the URL (which the audit
 * row would otherwise carry into a table other people can read), not the
 * calendar names.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await req.json().catch(() => null);
  const parsed = caldavConnectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const existing = getAccountForUser(userId, "caldav");
  let password = parsed.data.password;
  if (!password) {
    if (!existing?.caldavPasswordEncrypted) {
      return NextResponse.json(
        { error: "Enter your CalDAV app password." },
        { status: 400 }
      );
    }
    password = getCaldavCredentials(existing).password;
  }

  let serverUrl: string;
  try {
    serverUrl = normalizeCaldavUrl(parsed.data.serverUrl).href;
  } catch (err) {
    if (err instanceof CaldavUrlError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  try {
    const discovery = await discoverCalendars({
      serverUrl,
      username: parsed.data.username,
      password,
    });

    upsertCaldavAccount({
      userId,
      serverUrl,
      username: parsed.data.username,
      // Only pass the plaintext through when it's genuinely new; otherwise
      // leave the stored ciphertext untouched.
      password: parsed.data.password || null,
      homeUrl: discovery.homeUrl,
    });

    logAuditEntry({
      userId,
      targetUserId: userId,
      action: "calendar_connect",
      notes: `caldav server connected (calendars discovered=${discovery.calendars.length})`,
    });

    return NextResponse.json({
      ok: true,
      calendars: discovery.calendars,
      state: buildCalendarPanelState(userId),
    });
  } catch (err) {
    // The server's own words are what the user needs — a bad password, an
    // unreachable host and a TLS failure are three different fixes.
    const message =
      err instanceof CaldavError || err instanceof CaldavUrlError
        ? err.message
        : "Could not connect to that CalDAV server.";
    if (!(err instanceof CaldavError) && !(err instanceof CaldavUrlError)) {
      console.error("[calendar] caldav connect failed:", err);
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
