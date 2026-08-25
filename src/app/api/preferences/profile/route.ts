import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { profileNameSchema } from "@/lib/validators";
import { logAuditEntry } from "@/lib/audit";

/**
 * Updates the logged-in user's display name.
 *
 * Self-service only: the target row is always `session.user.id`. There is
 * deliberately no id in the request body and no admin override — an admin who
 * needs to change someone else's record uses /api/admin/users/[id].
 */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = profileNameSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const userId = session.user.id;
  const existing = db.select().from(users).where(eq(users.id, userId)).get();
  if (!existing) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name } = parsed.data;
  db.update(users).set({ name }).where(eq(users.id, userId)).run();

  if (existing.name !== name) {
    logAuditEntry({
      userId,
      action: "profile_update",
      targetUserId: userId,
      notes: `Changed display name from "${existing.name}" to "${name}"`,
    });
  }

  return NextResponse.json({ name, message: "Display name updated." });
}
