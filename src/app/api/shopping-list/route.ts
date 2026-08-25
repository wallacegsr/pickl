import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { todayDateString } from "@/lib/dates";
import { shoppingListStatusSchema } from "@/lib/validators";
import { buildShoppingListWeek, setOnHand } from "@/lib/shoppingList";
import { resolvePlanContext } from "@/lib/planContext";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const week = req.nextUrl.searchParams.get("week") || todayDateString();
  const scopeParam = req.nextUrl.searchParams.get("scope");
  const targetUserId = req.nextUrl.searchParams.get("userId");

  const resolved = resolvePlanContext(session.user, scopeParam, targetUserId, "read");
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const days = buildShoppingListWeek(week, resolved.context.scope, resolved.context.userId);

  return NextResponse.json({
    week,
    scope: resolved.context.scope,
    userId: resolved.context.userId || null,
    days,
  });
}

/**
 * Toggles on-hand status for one ingredient line. Checking items off a
 * shopping list is a personal-use checklist, not a plan edit, so this only
 * requires read access to the calendar (matching plan_entries' private-scope
 * access rules), not shared-calendar edit permission.
 */
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = shoppingListStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const { date, mealType, ingredientText, onHand, scope, userId } = parsed.data;

  const resolved = resolvePlanContext(session.user, scope, userId, "read");
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const updated = setOnHand({
    scope: resolved.context.scope,
    userId: resolved.context.userId,
    date,
    mealType,
    ingredientText,
    onHand,
    actingUserId: session.user.id,
  });

  return NextResponse.json(updated);
}
