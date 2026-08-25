import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { isAdmin } from "@/lib/permissions";
import { logAuditEntry } from "@/lib/audit";

interface Params {
  params: { id: string };
}

const patchSchema = z.object({
  role: z.enum(["admin", "member"]).optional(),
  active: z.boolean().optional(),
  verified: z.boolean().optional(),
  canAccessSharedCalendar: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const target = db.select().from(users).where(eq(users.id, params.id)).get();
  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }
  const data = parsed.data;

  // Guard: the global admin's role/active status can never be changed, by
  // anyone, including other admins. This is intentionally the ONLY
  // "protected user" guard left — it subsumes the old "can't demote/
  // deactivate the last remaining admin" check, since the global admin is
  // always role='admin' and can never be deactivated, so the system is
  // guaranteed to always have at least one admin. (canAccessSharedCalendar
  // is a separate, less consequential setting and is still allowed below,
  // though the global admin already has full access as an admin regardless.)
  if (target.isGlobalAdmin && (data.role !== undefined || data.active !== undefined)) {
    return NextResponse.json(
      { error: "The global admin's role cannot be changed." },
      { status: 400 }
    );
  }

  const updates: Partial<typeof users.$inferInsert> = {};
  if (data.role !== undefined) updates.role = data.role;
  if (data.active !== undefined) updates.active = data.active;
  if (data.canAccessSharedCalendar !== undefined)
    updates.canAccessSharedCalendar = data.canAccessSharedCalendar;
  if (data.verified !== undefined) {
    updates.emailVerified = data.verified ? new Date() : null;
  }

  if (Object.keys(updates).length > 0) {
    db.update(users).set(updates).where(eq(users.id, params.id)).run();
  }

  logAuditEntry({
    userId: session.user.id,
    action: "permission_change",
    targetUserId: params.id,
    notes: `Updated user ${target.email}: ${JSON.stringify(data)}`,
  });

  const updated = db.select().from(users).where(eq(users.id, params.id)).get();
  return NextResponse.json({
    id: updated!.id,
    name: updated!.name,
    email: updated!.email,
    role: updated!.role,
    active: updated!.active,
    verified: Boolean(updated!.emailVerified),
    canAccessSharedCalendar: updated!.canAccessSharedCalendar,
    isGlobalAdmin: updated!.isGlobalAdmin,
  });
}
