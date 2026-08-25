import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { themePreferenceSchema } from "@/lib/validators";
import { logAuditEntry } from "@/lib/audit";

/**
 * Persists the logged-in user's theme preference so it follows them to
 * another device. localStorage remains the pre-hydration source of truth for
 * the no-flash paint; this is the durable copy (see ThemeSync).
 *
 * Self-service only: always `session.user.id`, no id accepted from the client.
 */
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = themePreferenceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid theme" },
      { status: 400 }
    );
  }

  const userId = session.user.id;
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const theme = parsed.data.theme;
  if (user.themePreference !== theme) {
    db.update(users)
      .set({ themePreference: theme })
      .where(eq(users.id, userId))
      .run();

    logAuditEntry({
      userId,
      action: "theme_change",
      targetUserId: userId,
      notes: `Changed theme preference from ${user.themePreference} to ${theme}`,
    });
  }

  return NextResponse.json({ theme });
}
