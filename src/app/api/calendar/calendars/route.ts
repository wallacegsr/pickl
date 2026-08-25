import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccountForUser, setAccountError } from "@/lib/calendar/accounts";
import {
  getAccessTokenForAccount,
  listUserCalendars,
} from "@/lib/calendar/googleOAuth";
import { ReauthRequiredError } from "@/lib/calendar/types";

/**
 * The signed-in user's OWN writable Google calendars, for the target
 * picker. Scoped by session user id; there is no way to ask for anyone
 * else's list, and no admin path to one.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const account = getAccountForUser(session.user.id, "google");
  if (!account) {
    return NextResponse.json(
      { error: "No Google account is connected." },
      { status: 400 }
    );
  }

  try {
    const token = await getAccessTokenForAccount(account);
    const calendars = await listUserCalendars(token);
    if (account.lastError) setAccountError(account.id, null);
    return NextResponse.json({ calendars });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not load your calendars.";
    if (err instanceof ReauthRequiredError) {
      setAccountError(account.id, message);
      return NextResponse.json(
        { error: message, reauthRequired: true },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
