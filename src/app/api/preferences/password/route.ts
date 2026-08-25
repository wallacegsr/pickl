import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { passwordChangeSchema } from "@/lib/validators";
import { logAuditEntry } from "@/lib/audit";

/**
 * Changes the logged-in user's own password.
 *
 * Self-service only: always `session.user.id`, no id accepted from the client
 * and no admin override. Requires the current password even though the
 * session is already authenticated — an unattended open session should not be
 * enough to take over the account.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = passwordChangeSchema.safeParse(body);
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

  const matches = await bcrypt.compare(
    parsed.data.currentPassword,
    user.passwordHash
  );
  if (!matches) {
    return NextResponse.json(
      { error: "Current password is incorrect." },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  db.update(users).set({ passwordHash }).where(eq(users.id, userId)).run();

  // Records that a change happened — never any password material.
  logAuditEntry({
    userId,
    action: "password_change",
    targetUserId: userId,
    notes: "Changed own password",
  });

  return NextResponse.json({ message: "Password changed." });
}
