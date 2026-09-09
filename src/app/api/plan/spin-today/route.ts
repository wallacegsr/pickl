import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { todayDateString } from "@/lib/dates";
import { dessertSlotFor, getSlotEntries, getRecipePool, getWeekPlan, setPlanEntry, shuffle } from "@/lib/plan";
import { spinTodaySchema } from "@/lib/validators";
import { resolvePlanContext } from "@/lib/planContext";
import { db } from "@/db";
import { recipes } from "@/db/schema";
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
  const { mealTypes, includeDessert, scope, userId, force } = parsed.data;

  const resolved = resolvePlanContext(session.user, scope, userId, "write");
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const { householdId, scope: ctxScope, userId: ctxUserId } = resolved.context;

  const today = todayDateString();

  if (!force) {
    // A slot can hold several recipes, so a conflict names all of them.
    const conflicts: { mealType: MealType; currentRecipes: unknown[] }[] = [];
    for (const mealType of mealTypes) {
      // Any recipe in the slot makes it a conflict; a slot with a main and a
      // dessert is just as 'already planned' as one with a single meal.
      const existing = getSlotEntries(householdId, today, ctxScope, ctxUserId, mealType);
      const existingIds = existing
        .map((e) => e.recipeId)
        .filter((id): id is string => Boolean(id));
      if (existingIds.length > 0) {
        const current = db
          .select()
          .from(recipes)
          .where(and(eq(recipes.householdId, householdId), inArray(recipes.id, existingIds)))
          .all();
        conflicts.push({ mealType, currentRecipes: current });
      }
    }
    if (conflicts.length > 0) {
      return NextResponse.json({ needsConfirmation: true, conflicts }, { status: 409 });
    }
  }

  const weekPlan = getWeekPlan(householdId, today, ctxScope, ctxUserId);

  const results: { mealType: MealType; recipe: { id: string; name: string } | null }[] = [];
  const errors: string[] = [];

  // Where a dessert goes, if one was asked for.
  const dessertSlot = includeDessert ? dessertSlotFor(mealTypes) : null;

  for (const mealType of mealTypes) {
    // "main" so shaking for dinner never proposes cake.
    const pool = getRecipePool(householdId, ctxScope, ctxUserId, mealType, "main");
    if (pool.length === 0) {
      errors.push(`No eligible recipes for ${mealType}.`);
      results.push({ mealType, recipe: null });
      continue;
    }

    const usedThisWeek = new Set(
      weekPlan
        .filter((d) => d.date !== today)
        .flatMap((d) => d.meals[mealType].recipes.map((r) => r.recipe.id))
    );
    const unused = pool.filter((r) => !usedThisWeek.has(r.id));
    const drawPool = unused.length > 0 ? unused : pool;
    const picked = shuffle(drawPool)[0];

    const recipeIds = [picked.id];

    if (mealType === dessertSlot) {
      const dessertPool = getRecipePool(householdId, ctxScope, ctxUserId, mealType, "dessert");
      if (dessertPool.length === 0) {
        errors.push("No recipes are tagged as desserts yet.");
      } else {
        // Second in the slot, so the main keeps position 0 and the dessert
        // reads as following it.
        recipeIds.push(shuffle(dessertPool)[0].id);
      }
    }

    setPlanEntry({
      householdId,
      date: today,
      scope: ctxScope,
      userId: ctxUserId,
      mealType,
      recipeIds,
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
