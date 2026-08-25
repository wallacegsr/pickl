import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { resendVerificationSchema } from "@/lib/validators";
import { generateToken, tokenExpiryDate } from "@/lib/tokens";
import { sendVerificationEmail } from "@/lib/mail";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = resendVerificationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase();
  const user = db.select().from(users).where(eq(users.email, email)).get();

  // Always return a generic success message to avoid leaking account existence.
  const genericResponse = NextResponse.json({
    message:
      "If an account with that email exists and is unverified, a new verification email has been sent.",
  });

  if (!user || user.emailVerified) {
    return genericResponse;
  }

  const token = generateToken();
  db.update(users)
    .set({
      verificationToken: token,
      verificationTokenExpires: tokenExpiryDate(24),
    })
    .where(eq(users.id, user.id))
    .run();

  try {
    await sendVerificationEmail(email, token);
  } catch (err) {
    console.error("Failed to resend verification email:", err);
  }

  return genericResponse;
}
