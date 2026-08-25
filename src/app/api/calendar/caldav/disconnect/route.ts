import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logAuditEntry } from "@/lib/audit";
import {
  deleteAccountForUser,
  getAccountForUser,
} from "@/lib/calendar/accounts";

/**
 * Disconnects the CALLER's own CalDAV server. Takes no input: the owner
 * is the session user, always.
 *
 * Unlike Google there is nothing to revoke remotely — an app password is
 * revoked in the provider's own account settings, which the UI tells the
 * user to do. What we can do is forget it, which is what this does: the
 * account row (and with it the encrypted password), the targets pointing
 * at it, and their event links.
 *
 * Events already pushed to the remote calendar are deliberately LEFT
 * ALONE, for the same reason as the Google flow: deleting weeks of
 * someone's calendar entries is a far more destructive surprise than
 * leaving them there.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const account = getAccountForUser(session.user.id, "caldav");
  if (!account) {
    return NextResponse.json({ ok: true });
  }

  deleteAccountForUser(session.user.id, "caldav");

  logAuditEntry({
    userId: session.user.id,
    targetUserId: session.user.id,
    action: "calendar_disconnect",
    notes: "caldav server disconnected",
  });

  return NextResponse.json({
    ok: true,
    message:
      "CalDAV server disconnected and your stored password deleted. Events already added to that calendar were left in place — and you can revoke the app password in your provider's account settings.",
  });
}
