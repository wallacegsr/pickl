import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { householdScope, isAdmin } from "@/lib/permissions";
import { adminInviteUserSchema } from "@/lib/validators";
import { generateToken, tokenExpiryDate } from "@/lib/tokens";
import { sendInviteEmail } from "@/lib/mail";
import { logAuditEntry } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = adminInviteUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const { name, role } = parsed.data;
  const email = parsed.data.email.toLowerCase();

  // The invitee joins the inviter's household. There is no UI for choosing
  // another one, and there should not be: an admin invites people into their
  // own family.
  const householdId = householdScope(session.user);
  if (!householdId) {
    return NextResponse.json(
      { error: "This account is not part of a household." },
      { status: 403 }
    );
  }

  // Deliberately NOT household-scoped, unlike everything else here: email is
  // the login identity, so it has to stay unique across the deployment. Two
  // households cannot both hold an account for the same address.
  const existing = db.select().from(users).where(eq(users.email, email)).get();
  if (existing) {
    return NextResponse.json(
      { error: "An account with that email already exists." },
      { status: 409 }
    );
  }

  // Unusable placeholder password hash: a bcrypt hash of a random UUID that
  // nobody knows, so authorize()'s bcrypt.compare() naturally rejects any
  // login attempt before the invite is accepted (never a guessable/empty
  // value).
  const placeholderPasswordHash = await bcrypt.hash(randomUUID(), 10);
  const token = generateToken();
  const id = randomUUID();

  db.insert(users)
    .values({
      id,
      householdId,
      name,
      email,
      passwordHash: placeholderPasswordHash,
      emailVerified: null,
      role,
      active: true,
      isGlobalAdmin: false,
      inviteToken: token,
      inviteTokenExpires: tokenExpiryDate(24),
    })
    .run();

  try {
    await sendInviteEmail(email, token, session.user.name || "An admin");
  } catch (err) {
    console.error("Failed to send invite email:", err);
  }

  logAuditEntry({
    userId: session.user.id,
    action: "permission_change",
    targetUserId: id,
    notes: `Invited user ${email} with role ${role}`,
  });

  return NextResponse.json({
    id,
    name,
    email,
    role,
    active: true,
    verified: false,
    canAccessSharedCalendar: true,
    isGlobalAdmin: false,
    message: `Invitation sent to ${email}.`,
  });
}
