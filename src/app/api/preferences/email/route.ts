import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { and, eq, ne } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { emailChangeRequestSchema } from "@/lib/validators";
import { generateToken, tokenExpiryDate } from "@/lib/tokens";
import { sendEmailChangeVerificationEmail } from "@/lib/mail";
import { logAuditEntry } from "@/lib/audit";

/**
 * Requests a change of the logged-in user's email address.
 *
 * The account's live `email` is NOT touched here. The requested address is
 * parked in `pendingEmail` with its own token and the confirmation link goes
 * to the NEW address; only when that link is consumed
 * (/api/auth/confirm-email-change) does the login address actually move. A
 * typo'd address therefore costs the user nothing — they keep logging in with
 * the old one and can cancel with DELETE.
 *
 * Self-service only: always operates on `session.user.id`; no id is accepted
 * from the client.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = emailChangeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const userId = session.user.id;
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const passwordMatches = await bcrypt.compare(
    parsed.data.currentPassword,
    user.passwordHash
  );
  if (!passwordMatches) {
    return NextResponse.json(
      { error: "Current password is incorrect." },
      { status: 400 }
    );
  }

  const email = parsed.data.email.toLowerCase();
  if (email === user.email) {
    return NextResponse.json(
      { error: "That is already your email address." },
      { status: 400 }
    );
  }

  // Checked here and AGAIN at confirm time — the address could be claimed by
  // a signup or an admin-created account in between.
  const taken = db
    .select()
    .from(users)
    .where(and(eq(users.email, email), ne(users.id, userId)))
    .get();
  if (taken) {
    return NextResponse.json(
      { error: "An account with that email already exists." },
      { status: 409 }
    );
  }

  const token = generateToken();
  db.update(users)
    .set({
      pendingEmail: email,
      pendingEmailToken: token,
      pendingEmailTokenExpires: tokenExpiryDate(24),
    })
    .where(eq(users.id, userId))
    .run();

  try {
    await sendEmailChangeVerificationEmail(email, token, user.email);
  } catch (err) {
    console.error("Failed to send email-change confirmation email:", err);
  }

  logAuditEntry({
    userId,
    action: "email_change_request",
    targetUserId: userId,
    // The pending address is the point of the record; the token never is.
    notes: `Requested email change from ${user.email} to ${email}`,
  });

  return NextResponse.json({
    pendingEmail: email,
    message: `Confirmation link sent to ${email}. Your current address stays active until you click it.`,
  });
}

/** Cancels a pending email change, clearing the parked address and token. */
export async function DELETE() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  db.update(users)
    .set({
      pendingEmail: null,
      pendingEmailToken: null,
      pendingEmailTokenExpires: null,
    })
    .where(eq(users.id, userId))
    .run();

  if (user.pendingEmail) {
    logAuditEntry({
      userId,
      action: "email_change_cancel",
      targetUserId: userId,
      notes: `Cancelled pending email change to ${user.pendingEmail}`,
    });
  }

  return NextResponse.json({
    pendingEmail: null,
    message: "Pending email change cancelled.",
  });
}
