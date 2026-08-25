import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getAccountForUser,
  getCaldavCredentials,
  setAccountError,
} from "@/lib/calendar/accounts";
import { CaldavError, discoverCalendars } from "@/lib/calendar/caldavClient";
import { CaldavUrlError } from "@/lib/calendar/caldavUrl";

/**
 * The signed-in user's OWN CalDAV calendars, for the target picker —
 * the CalDAV counterpart of /api/calendar/calendars.
 *
 * Scoped by session user id; there is no way to ask for anyone else's,
 * and no admin path to one. The stored password is decrypted for the
 * duration of the discovery request and never appears in the response.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const account = getAccountForUser(session.user.id, "caldav");
  if (!account) {
    return NextResponse.json(
      { error: "No CalDAV server is connected." },
      { status: 400 }
    );
  }

  try {
    const discovery = await discoverCalendars(getCaldavCredentials(account));
    if (account.lastError) setAccountError(account.id, null);
    return NextResponse.json({ calendars: discovery.calendars });
  } catch (err) {
    const message =
      err instanceof CaldavError || err instanceof CaldavUrlError
        ? err.message
        : "Could not load your CalDAV calendars.";
    // A dead credential should surface as one account-level banner rather
    // than silently failing every future push.
    if (err instanceof CaldavError && err.status === 401) {
      setAccountError(account.id, message);
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
