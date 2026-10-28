import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolvePlanContext } from "@/lib/planContext";
import { suspensionError } from "@/lib/households";
import { addExtra, MAX_EXTRA_LENGTH } from "@/lib/shoppingExtras";
import { scopeSchema } from "@/lib/validators";

const addSchema = z.object({
  /** Any date in the week the item belongs to. */
  week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  text: z.string().trim().min(1, "Enter something to add.").max(MAX_EXTRA_LENGTH),
  scope: scopeSchema.default("shared"),
  userId: z.string().nullable().optional(),
});

/**
 * Adds an extra to a week's list. Like ticking an ingredient off, this is a
 * checklist change rather than a plan edit, so seeing the list is enough —
 * but a suspended household is still frozen.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }
  const { week, text, scope, userId } = parsed.data;

  const resolved = resolvePlanContext(session.user, scope, userId, "read");
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const suspended = suspensionError(resolved.context.householdId);
  if (suspended) return NextResponse.json({ error: suspended.error }, { status: suspended.status });

  const result = addExtra(resolved.context, week, text, session.user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.item, { status: 201 });
}
