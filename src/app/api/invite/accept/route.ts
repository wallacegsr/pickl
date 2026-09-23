import { NextRequest, NextResponse } from "next/server";
import { clientIp, hit } from "@/lib/rateLimit";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { acceptInviteSchema } from "@/lib/validators";

export async function POST(req: NextRequest) {
  // Invite tokens are long and random, but there is no reason to let anyone
  // try them at full speed.
  const limit = hit(`invite:${clientIp(req.headers)}`, 20, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = acceptInviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const { token, password } = parsed.data;

  const user = db
    .select()
    .from(users)
    .where(eq(users.inviteToken, token))
    .get();

  if (!user) {
    return NextResponse.json(
      { error: "That invite link is invalid." },
      { status: 400 }
    );
  }

  if (user.inviteTokenExpires && user.inviteTokenExpires.getTime() < Date.now()) {
    return NextResponse.json(
      { error: "That invite link has expired. Ask an admin to invite you again." },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);

  db.update(users)
    .set({
      passwordHash,
      emailVerified: new Date(),
      inviteToken: null,
      inviteTokenExpires: null,
    })
    .where(eq(users.id, user.id))
    .run();

  return NextResponse.json({ message: "Your account is ready. You can log in now." });
}
