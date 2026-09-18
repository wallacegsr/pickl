import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { formatPickerChips, MAX_PICKER_CHIPS } from "@/lib/pickerChips";
import { MAX_TAG_LENGTH } from "@/lib/tagNames";

/**
 * Which tag chips this person wants in the recipe picker.
 *
 * Self-service and nothing else: the user id comes from the session, so there
 * is no way to set anyone else's. An empty list is not an error — it means
 * "use the default set", which is what the Default radio sends.
 *
 * Names are stored as typed rather than as tag ids: a chip for a tag that is
 * later renamed or deleted should quietly stop matching, not point at a row
 * that no longer exists.
 */
const schema = z.object({
  tags: z.array(z.string().trim().max(MAX_TAG_LENGTH)).max(MAX_PICKER_CHIPS),
});

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const stored = formatPickerChips(parsed.data.tags);
  db.update(users).set({ pickerChips: stored }).where(eq(users.id, session.user.id)).run();

  return NextResponse.json({ tags: stored ? stored.split(",") : [] });
}
