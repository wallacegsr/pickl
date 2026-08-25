import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { isAdmin } from "@/lib/permissions";
import { adminManualAddUserSchema } from "@/lib/validators";
import { logAuditEntry } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = adminManualAddUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const { name, role, password } = parsed.data;
  const email = parsed.data.email.toLowerCase();

  const existing = db.select().from(users).where(eq(users.email, email)).get();
  if (existing) {
    return NextResponse.json(
      { error: "An account with that email already exists." },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const id = randomUUID();

  db.insert(users)
    .values({
      id,
      name,
      email,
      passwordHash,
      // The admin is vouching for this account directly, so it's created
      // already verified and active — no email verification step needed.
      emailVerified: new Date(),
      role,
      active: true,
      isGlobalAdmin: false,
    })
    .run();

  logAuditEntry({
    userId: session.user.id,
    action: "permission_change",
    targetUserId: id,
    notes: `Manually created user ${email} with role ${role}`,
  });

  const created = db.select().from(users).where(eq(users.id, id)).get()!;

  return NextResponse.json({
    id: created.id,
    name: created.name,
    email: created.email,
    role: created.role,
    active: created.active,
    verified: Boolean(created.emailVerified),
    canAccessSharedCalendar: created.canAccessSharedCalendar,
    isGlobalAdmin: created.isGlobalAdmin,
    // Returned once so the admin can share it with the user. Never
    // retrievable again after this response (only the bcrypt hash is
    // stored).
    temporaryPassword: password,
  });
}
