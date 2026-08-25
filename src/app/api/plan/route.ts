import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
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

  const plan = getWeekPlan(week, resolved.context.scope, resolved.context.userId);

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

  const { date, recipeId, scope, mealType, userId } = parsed.data;

  const resolved = resolvePlanContext(session.user, scope, userId, "write");
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  if (recipeId) {
    const recipeExists = db
      .select()
      .from(recipes)
      .where(eq(recipes.id, recipeId))
      .get();
    if (!recipeExists) {
      return NextResponse.json(
        { error: "Recipe not found" },
        { status: 404 }
      );
    }
  }

  const updated = setPlanEntry({
    date,
    scope: resolved.context.scope,
    userId: resolved.context.userId,
    mealType,
    recipeId: recipeId ?? null,
    actingUserId: session.user.id,
    action: recipeId ? "manual_set" : "manual_clear",
  });

  return NextResponse.json(updated);
}
