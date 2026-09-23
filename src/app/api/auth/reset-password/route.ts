import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { resetPasswordSchema } from "@/lib/validators";
import { hashToken } from "@/lib/tokens";
import { logAuditEntry } from "@/lib/audit";
import { clear, clientIp, hit } from "@/lib/rateLimit";
import { findResetUser } from "@/lib/passwordReset";

/**
 * Sets a new password from an emailed reset link.
 *
 * The link is spent the moment it works, and every existing session for the
 * account ends — a reset usually means someone else may know the old
 * password, and a stolen session should not outlive it.
 */
export async function POST(req: NextRequest) {
  const limit = hit(`reset:${clientIp(req.headers)}`, 20, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  const parsed = resetPasswordSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const found = findResetUser(parsed.data.token);
  if (!found.ok) {
    return NextResponse.json({ error: found.error }, { status: 400 });
  }
  const user = found.user;

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  // Matched on the token hash as well as the id, so a link used twice at the
  // same moment changes the password once.
  const result = db
    .update(users)
    .set({
      passwordHash,
      resetTokenHash: null,
      resetTokenExpires: null,
      passwordChangedAt: new Date(),
    })
    .where(eq(users.resetTokenHash, hashToken(parsed.data.token)))
    .run();
  if (result.changes === 0) {
    return NextResponse.json({ error: "That reset link has already been used." }, { status: 400 });
  }

  // Whoever just proved they own the inbox shouldn't be locked out by the
  // failed guesses that may have prompted the reset.
  clear(`login:email:${user.email}`);

  logAuditEntry({
    userId: user.id,
    targetUserId: user.id,
    action: "password_reset",
    notes: "password reset from an emailed link; other sessions ended",
  });

  return NextResponse.json({ ok: true });
}
