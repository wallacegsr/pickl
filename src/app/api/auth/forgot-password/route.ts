import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { forgotPasswordSchema } from "@/lib/validators";
import { generateToken, hashToken } from "@/lib/tokens";
import { sendPasswordResetEmail } from "@/lib/mail";
import { logAuditEntry } from "@/lib/audit";
import { clientIp, hit } from "@/lib/rateLimit";

/** How long a reset link works. Short: it is as good as the password. */
const RESET_TOKEN_MINUTES = 60;

/** Always the same answer, so this page can't be used to test which addresses have accounts. */
const SENT = {
  message:
    "If that address has a Pickl account, a link to reset the password is on its way. It works for one hour.",
};

/**
 * "Forgot password": emails a one-hour, one-use link to choose a new one.
 *
 * Says the same thing, and takes the same time, whether or not the address
 * has an account — the email is sent in the background rather than awaited,
 * because waiting on the mail server only for real accounts would tell anyone
 * with a stopwatch which addresses are registered.
 *
 * Only a verified, active account gets a link. An unverified address never
 * proved it owns the inbox, and a deactivated one would only be refused at
 * login afterwards.
 */
export async function POST(req: NextRequest) {
  const perClient = hit(`forgot:${clientIp(req.headers)}`, 5, 60 * 60 * 1000);
  if (!perClient.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Wait a while before asking for another email." },
      { status: 429, headers: { "Retry-After": String(perClient.retryAfter) } }
    );
  }

  const parsed = forgotPasswordSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Enter a valid email address" },
      { status: 400 }
    );
  }
  const email = parsed.data.email.toLowerCase();

  // Per address as well, so nobody can fill one person's inbox with resets.
  // Over the limit it still answers "sent" — saying otherwise would confirm
  // the address is being asked about.
  if (!hit(`forgot:email:${email}`, 3, 60 * 60 * 1000).allowed) {
    return NextResponse.json(SENT);
  }

  const user = db.select().from(users).where(eq(users.email, email)).get();
  if (user && user.active && user.emailVerified) {
    const token = generateToken();
    db.update(users)
      .set({
        resetTokenHash: hashToken(token),
        resetTokenExpires: new Date(Date.now() + RESET_TOKEN_MINUTES * 60 * 1000),
      })
      .where(eq(users.id, user.id))
      .run();

    logAuditEntry({
      userId: user.id,
      targetUserId: user.id,
      action: "password_reset_request",
      notes: "reset link emailed",
    });

    void sendPasswordResetEmail(user.email, token).catch((err) => {
      console.error("[mail] password reset email failed:", err);
    });
  }

  return NextResponse.json(SENT);
}
