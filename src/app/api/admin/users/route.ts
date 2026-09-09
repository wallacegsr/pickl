import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { householdScope, isAdmin } from "@/lib/permissions";

export async function GET() {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const householdId = householdScope(session.user);
  if (!householdId) return NextResponse.json([]);

  // A household admin administers their own family. Managing OTHER
  // households is the platform operator's panel, and it deals in households
  // as objects — never in their members.
  const allUsers = db
    .select()
    .from(users)
    .where(eq(users.householdId, householdId))
    .all();

  const sanitized = allUsers.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active,
    verified: Boolean(u.emailVerified),
    canAccessSharedCalendar: u.canAccessSharedCalendar,
    isGlobalAdmin: u.isGlobalAdmin,
    createdAt: u.createdAt,
  }));

  return NextResponse.json(sanitized);
}
