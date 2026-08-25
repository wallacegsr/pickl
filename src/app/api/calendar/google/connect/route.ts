import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  buildConsentUrl,
  getAppBaseUrl,
  preferencesCalendarsUrl,
} from "@/lib/calendar/googleOAuth";
import { mintState } from "@/lib/calendar/oauthState";

/**
 * Starts the per-user Google consent flow.
 *
 * The user id comes from the session and nowhere else — this endpoint
 * takes no input at all, so there is no way to start a flow "on behalf of"
 * anyone else. The minted state binds the resulting callback to this
 * session (see src/lib/calendar/oauthState.ts).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", getAppBaseUrl()));
  }

  try {
    const state = mintState(session.user.id, "google");
    return NextResponse.redirect(buildConsentUrl(state));
  } catch (err) {
    // Almost always "an admin hasn't configured the OAuth client yet" —
    // show it in the UI rather than as a stack trace.
    const message =
      err instanceof Error
        ? err.message
        : "Could not start Google authorization.";
    return NextResponse.redirect(preferencesCalendarsUrl({ calendarError: message }));
  }
}
