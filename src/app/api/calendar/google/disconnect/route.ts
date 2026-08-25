import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logAuditEntry } from "@/lib/audit";
import { decrypt } from "@/lib/crypto";
import {
  deleteAccountForUser,
  getAccountForUser,
} from "@/lib/calendar/accounts";
import { revokeRefreshToken } from "@/lib/calendar/googleOAuth";

/**
 * Disconnects the CALLER's own Google account. Takes no input: the owner
 * is the session user, always.
 *
 * Two things happen, in this order:
 *   1. the refresh token is revoked at Google, so a stolen database backup
 *      cannot be replayed against the user's calendar later;
 *   2. the local account, its targets and its event links are deleted.
 *
 * Step 1 is best-effort — if Google is unreachable we still complete step
 * 2, which is the part we actually control, and report the revocation
 * failure so the user can revoke by hand from their Google account page.
 *
 * Events already pushed to the remote calendar are deliberately LEFT
 * ALONE: silently deleting a month of someone's calendar entries would be
 * a far more destructive surprise than leaving them there. The UI says so.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const account = getAccountForUser(session.user.id, "google");
  if (!account) {
    return NextResponse.json({ ok: true, revoked: false });
  }

  let revoked = false;
  let revokeError: string | null = null;
  if (account.refreshTokenEncrypted) {
    try {
      await revokeRefreshToken(decrypt(account.refreshTokenEncrypted));
      revoked = true;
    } catch (err) {
      revokeError =
        err instanceof Error ? err.message : "Token revocation failed.";
      console.error("[calendar] token revocation failed:", err);
    }
  }

  deleteAccountForUser(session.user.id, "google");

  logAuditEntry({
    userId: session.user.id,
    targetUserId: session.user.id,
    action: "calendar_disconnect",
    notes: `google account disconnected (revokedAtGoogle=${revoked})`,
  });

  return NextResponse.json({
    ok: true,
    revoked,
    revokeError,
    message: revoked
      ? "Google Calendar disconnected. Events already added to your calendar were left in place."
      : "Google Calendar disconnected locally, but the authorization could not be revoked at Google — you can remove it from your Google account's third-party access list. Events already added to your calendar were left in place.",
  });
}
