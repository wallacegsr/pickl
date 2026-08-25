import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { logAuditEntry } from "@/lib/audit";

/**
 * Consumes an email-change token and swaps the account's login address.
 *
 * Deliberately a separate route (and separate token columns) from
 * /api/auth/verify (signup) and /invite/accept — see src/db/schema.ts.
 * Unauthenticated by design: the link is opened from the new inbox, which may
 * well be a different browser with no session.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const baseUrl = req.nextUrl.origin;
  const fail = (error: string) =>
    NextResponse.redirect(`${baseUrl}/preferences?section=profile&error=${error}`);

  if (!token) return fail("missing_token");

  const user = db
    .select()
    .from(users)
    .where(eq(users.pendingEmailToken, token))
    .get();

  if (!user || !user.pendingEmail) return fail("invalid_token");

  if (
    user.pendingEmailTokenExpires &&
    user.pendingEmailTokenExpires.getTime() < Date.now()
  ) {
    return fail("expired_token");
  }

  // Re-check for a collision: the address was free when the change was
  // requested, but a signup or admin-created account could have claimed it in
  // the meantime, and users.email is UNIQUE.
  const taken = db
    .select()
    .from(users)
    .where(and(eq(users.email, user.pendingEmail), ne(users.id, user.id)))
    .get();
  if (taken) {
    return fail("email_taken");
  }

  const previousEmail = user.email;
  db.update(users)
    .set({
      email: user.pendingEmail,
      // The address is proven by this very click, so it stays verified.
      emailVerified: new Date(),
      pendingEmail: null,
      pendingEmailToken: null,
      pendingEmailTokenExpires: null,
    })
    .where(eq(users.id, user.id))
    .run();

  logAuditEntry({
    userId: user.id,
    action: "email_change_confirm",
    targetUserId: user.id,
    notes: `Confirmed email change from ${previousEmail} to ${user.pendingEmail}`,
  });

  // The session JWT still carries the old email, so send them through login
  // to pick up the new one.
  return NextResponse.redirect(`${baseUrl}/login?email_changed=1`);
}
