import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { signupSchema } from "@/lib/validators";
import { generateToken, tokenExpiryDate } from "@/lib/tokens";
import { sendVerificationEmail } from "@/lib/mail";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = signupSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const { name, password } = parsed.data;
  const email = parsed.data.email.toLowerCase();

  const existing = db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .get();

  if (existing) {
    return NextResponse.json(
      { error: "An account with that email already exists." },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const token = generateToken();

  // Bootstrap problem: no admin exists until someone signs up. The very
  // first user ever created automatically becomes admin AND the permanent
  // global admin (isGlobalAdmin is fixed forever at this moment — see
  // src/db/schema.ts).
  const userCount = db.select().from(users).all().length;
  const isFirstUser = userCount === 0;
  const role = isFirstUser ? "admin" : "member";

  // The first account skips email verification entirely.
  //
  // Otherwise the deployment deadlocks: SMTP is configured from /admin, which
  // requires being logged in, which requires a verification email that an
  // unconfigured (or misconfigured) SMTP server cannot send. The admin would
  // have to go digging in container logs for the link.
  //
  // It costs nothing in security. Verification proves control of an address,
  // which matters when an account is joining an existing household — there is
  // someone to impersonate and an admin to mislead. For the very first account
  // on an empty deployment there is neither: whoever reaches signup first
  // becomes the global admin either way, and an attacker who got there first
  // would simply verify their own address. See SECURITY.md — the real control
  // is creating this account yourself before exposing the app.
  db.insert(users)
    .values({
      id: randomUUID(),
      name,
      email,
      passwordHash,
      emailVerified: isFirstUser ? new Date() : null,
      verificationToken: isFirstUser ? null : token,
      verificationTokenExpires: isFirstUser ? null : tokenExpiryDate(24),
      role,
      isGlobalAdmin: isFirstUser,
    })
    .run();

  if (!isFirstUser) {
    try {
      await sendVerificationEmail(email, token);
    } catch (err) {
      console.error("Failed to send verification email:", err);
    }
  }

  return NextResponse.json({
    message: isFirstUser
      ? "Admin account created. You can log in now — no email verification needed for the first account. Set up email under Back of House once you are in."
      : "Account created. Please check your email for a verification link.",
  });
}
