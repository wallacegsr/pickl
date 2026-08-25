import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logAuditEntry } from "@/lib/audit";
import { upsertAccount } from "@/lib/calendar/accounts";
import {
  exchangeCodeForTokens,
  getAppBaseUrl,
  preferencesCalendarsUrl,
} from "@/lib/calendar/googleOAuth";
import { consumeState } from "@/lib/calendar/oauthState";

/**
 * The Google OAuth redirect target.
 *
 * Order of operations matters here and is deliberate:
 *   1. require a logged-in session;
 *   2. handle Google's own `error=` (Cancel) gracefully;
 *   3. **validate and consume the state** — missing, unknown, expired,
 *      already-used, or minted for a different user all reject, and the
 *      authorization code is never exchanged in any of those cases;
 *   4. only then exchange the code and store the (encrypted) refresh
 *      token against the SESSION's user id — never a user id from the
 *      query string, which is why a callback can't attach an account to
 *      someone who didn't initiate the flow.
 *
 * Every failure path redirects back to Preferences with a short message.
 * No stack trace, no token, and no code ever reaches the browser.
 */

const STATE_MESSAGES: Record<string, string> = {
  missing:
    "That Google authorization was missing its security token. Please start again from Preferences.",
  unknown:
    "That Google authorization could not be verified. Please start again from Preferences.",
  expired:
    "That Google authorization link expired. Please start again from Preferences.",
  used: "That Google authorization link has already been used. Please start again from Preferences.",
  wrong_user:
    "That Google authorization was started by a different account. Please start again from Preferences.",
};

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", getAppBaseUrl()));
  }

  const params = req.nextUrl.searchParams;

  const googleError = params.get("error");
  if (googleError) {
    const message =
      googleError === "access_denied"
        ? "Google Calendar was not connected — you cancelled the authorization."
        : `Google reported an error while authorizing: ${googleError}.`;
    return NextResponse.redirect(preferencesCalendarsUrl({ calendarError: message }));
  }

  // Validate + burn the state BEFORE touching the authorization code.
  const stateResult = consumeState(params.get("state"), session.user.id, "google");
  if (!stateResult.ok) {
    return NextResponse.redirect(
      preferencesCalendarsUrl({
        calendarError: STATE_MESSAGES[stateResult.reason] ?? STATE_MESSAGES.unknown,
      })
    );
  }

  const code = params.get("code");
  if (!code) {
    return NextResponse.redirect(
      preferencesCalendarsUrl({
        calendarError: "Google did not return an authorization code. Please try again.",
      })
    );
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const account = upsertAccount({
      userId: session.user.id,
      provider: "google",
      refreshToken: tokens.refreshToken,
      accountEmail: tokens.accountEmail,
      scopes: tokens.scopes,
    });

    // Non-secret context only: which provider, and the account label the
    // user themselves will see. Never the token.
    logAuditEntry({
      userId: session.user.id,
      targetUserId: session.user.id,
      action: "calendar_connect",
      notes: `google account connected (${account.accountEmail ?? "unknown address"})`,
    });

    return NextResponse.redirect(
      preferencesCalendarsUrl({
        calendarMessage: `Connected ${account.accountEmail ?? "your Google account"}. Choose which calendars to mirror below.`,
      })
    );
  } catch (err) {
    console.error("[calendar] google callback failed:", err);
    const message =
      err instanceof Error
        ? err.message
        : "Could not complete the Google authorization.";
    return NextResponse.redirect(preferencesCalendarsUrl({ calendarError: message }));
  }
}
