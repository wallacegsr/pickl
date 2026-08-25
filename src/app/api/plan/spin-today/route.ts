import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { todayDateString } from "@/lib/dates";
import { getPlanEntry, getRecipePool, getWeekPlan, setPlanEntry, shuffle } from "@/lib/plan";
import { spinTodaySchema } from "@/lib/validators";
import { resolvePlanContext } from "@/lib/planContext";
import { db } from "@/db";
import { recipes } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { MealType } from "@/db/schema";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = spinTodaySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }
  const { mealTypes, scope, userId, force } = parsed.data;

  const resolved = resolvePlanContext(session.user, scope, userId, "write");
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const { scope: ctxScope, userId: ctxUserId } = resolved.context;

  const today = todayDateString();

  if (!force) {
    const conflicts: { mealType: MealType; currentRecipe: unknown }[] = [];
    for (const mealType of mealTypes) {
      const existing = getPlanEntry(today, ctxScope, ctxUserId, mealType);
      if (existing?.recipeId) {
        const currentRecipe = db
          .select()
          .from(recipes)
          .where(eq(recipes.id, existing.recipeId))
          .get();
        conflicts.push({ mealType, currentRecipe });
      }
    }
    if (conflicts.length > 0) {
      return NextResponse.json({ needsConfirmation: true, conflicts }, { status: 409 });
    }
  }

  const weekPlan = getWeekPlan(today, ctxScope, ctxUserId);

  const results: { mealType: MealType; recipe: { id: string; name: string } | null }[] = [];
  const errors: string[] = [];

  for (const mealType of mealTypes) {
    const pool = getRecipePool(ctxScope, ctxUserId, mealType);
    if (pool.length === 0) {
      errors.push(`No eligible recipes for ${mealType}.`);
      results.push({ mealType, recipe: null });
      continue;
    }

    const usedThisWeek = new Set(
      weekPlan
        .filter((d) => d.date !== today)
        .map((d) => d.meals[mealType]?.recipe?.id)
        .filter((id): id is string => Boolean(id))
    );
    const unused = pool.filter((r) => !usedThisWeek.has(r.id));
    const drawPool = unused.length > 0 ? unused : pool;
    const picked = shuffle(drawPool)[0];

    setPlanEntry({
      date: today,
      scope: ctxScope,
      userId: ctxUserId,
      mealType,
      recipeId: picked.id,
      actingUserId: session.user.id,
      action: "spin_today",
    });

    results.push({ mealType, recipe: { id: picked.id, name: picked.name } });
  }

  return NextResponse.json({
    date: today,
    results,
    note: errors.length > 0 ? errors.join(" ") : null,
  });
}
