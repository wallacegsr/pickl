import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const baseUrl = req.nextUrl.origin;

  if (!token) {
    return NextResponse.redirect(
      `${baseUrl}/login?error=missing_token`
    );
  }

  const user = db
    .select()
    .from(users)
    .where(eq(users.verificationToken, token))
    .get();

  if (!user) {
    return NextResponse.redirect(`${baseUrl}/login?error=invalid_token`);
  }

  if (
    user.verificationTokenExpires &&
    user.verificationTokenExpires.getTime() < Date.now()
  ) {
    return NextResponse.redirect(`${baseUrl}/login?error=expired_token`);
  }

  db.update(users)
    .set({
      emailVerified: new Date(),
      verificationToken: null,
      verificationTokenExpires: null,
    })
    .where(eq(users.id, user.id))
    .run();

  return NextResponse.redirect(`${baseUrl}/login?verified=1`);
}
