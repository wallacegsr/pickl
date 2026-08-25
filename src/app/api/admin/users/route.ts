import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { isAdmin } from "@/lib/permissions";

export async function GET() {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const allUsers = db.select().from(users).all();

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
