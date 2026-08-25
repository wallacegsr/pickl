import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRemainingDaysInWeek, todayDateString } from "@/lib/dates";
import { getPlanEntry, getRecipePool, setPlanEntry, shuffle } from "@/lib/plan";
import { spinWeekSchema } from "@/lib/validators";
import { resolvePlanContext } from "@/lib/planContext";
import type { MealType } from "@/db/schema";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = spinWeekSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }
  const { mealTypes, scope, userId, overwriteExisting } = parsed.data;

  const resolved = resolvePlanContext(session.user, scope, userId, "write");
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const { scope: ctxScope, userId: ctxUserId } = resolved.context;

  const today = todayDateString();
  const remainingDays = getRemainingDaysInWeek(today);

  const filledDates: { mealType: MealType; date: string }[] = [];
  let unfilledCount = 0;
  const notes: string[] = [];

  for (const mealType of mealTypes) {
    const daysToFill = remainingDays.filter((day) => {
      if (overwriteExisting) return true;
      const existing = getPlanEntry(day.date, ctxScope, ctxUserId, mealType);
      return !existing?.recipeId;
    });

    const pool = shuffle(getRecipePool(ctxScope, ctxUserId, mealType));
    if (pool.length === 0 && daysToFill.length > 0) {
      notes.push(`No eligible recipes for ${mealType}.`);
      unfilledCount += daysToFill.length;
      continue;
    }

    daysToFill.forEach((day, index) => {
      const recipe = pool[index];
      if (!recipe) {
        unfilledCount++;
        return;
      }

      setPlanEntry({
        date: day.date,
        scope: ctxScope,
        userId: ctxUserId,
        mealType,
        recipeId: recipe.id,
        actingUserId: session.user.id,
        action: "spin_week",
      });

      filledDates.push({ mealType, date: day.date });
    });

    if (pool.length > 0 && pool.length < daysToFill.length) {
      notes.push(
        `Not enough distinct ${mealType} recipes for all remaining days — some day(s) were left unplanned.`
      );
    }
  }

  return NextResponse.json({
    filledDates,
    unfilledCount,
    note: notes.length > 0 ? notes.join(" ") : null,
  });
}
