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

  db.insert(users)
    .values({
      id: randomUUID(),
      name,
      email,
      passwordHash,
      emailVerified: null,
      verificationToken: token,
      verificationTokenExpires: tokenExpiryDate(24),
      role,
      isGlobalAdmin: isFirstUser,
    })
    .run();

  try {
    await sendVerificationEmail(email, token);
  } catch (err) {
    console.error("Failed to send verification email:", err);
  }

  return NextResponse.json({
    message:
      "Account created. Please check your email for a verification link.",
  });
}
