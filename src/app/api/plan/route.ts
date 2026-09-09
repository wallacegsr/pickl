import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { recipes } from "@/db/schema";
import { planEntrySchema } from "@/lib/validators";
import { getWeekPlan, setPlanEntry } from "@/lib/plan";
import { todayDateString } from "@/lib/dates";
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

  const plan = getWeekPlan(
    resolved.context.householdId,
    week,
    resolved.context.scope,
    resolved.context.userId
  );

  return NextResponse.json({
    week,
    scope: resolved.context.scope,
    userId: resolved.context.userId || null,
    days: plan,
  });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = planEntrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const { date, recipeIds, scope, mealType, userId } = parsed.data;

  const resolved = resolvePlanContext(session.user, scope, userId, "write");
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  if (recipeIds.length > 0) {
    // Checked in one query rather than a loop: a slot holds few recipes, but
    // a caller can send any list and each one still has to exist.
    const found = db
      .select({ id: recipes.id })
      .from(recipes)
      .where(
        and(
          eq(recipes.householdId, resolved.context.householdId),
          inArray(recipes.id, recipeIds)
        )
      )
      .all();
    if (found.length !== new Set(recipeIds).size) {
      return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    }
  }

  const updated = setPlanEntry({
    householdId: resolved.context.householdId,
    date,
    scope: resolved.context.scope,
    userId: resolved.context.userId,
    mealType,
    recipeIds,
    actingUserId: session.user.id,
    action: recipeIds.length > 0 ? "manual_set" : "manual_clear",
  });

  return NextResponse.json(updated);
}
