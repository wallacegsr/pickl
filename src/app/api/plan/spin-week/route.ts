import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRemainingDaysInWeek } from "@/lib/dates";
import { viewerToday } from "@/lib/viewerToday";
import { dessertSlotFor, getSlotEntries, getRecipePool, setPlanEntry, shuffle } from "@/lib/plan";
import { spinWeekSchema } from "@/lib/validators";
import { resolvePlanContext } from "@/lib/planContext";
import { buildSpinFilter, noDessertsMessage, noMainsMessage } from "@/lib/spinFilter";
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
  const {
    mealTypes,
    includeDessert,
    scope,
    userId,
    overwriteExisting,
    tags,
    tagMatch,
    favoritesOnly,
  } = parsed.data;

  const resolved = resolvePlanContext(session.user, scope, userId, "write");
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const { householdId, scope: ctxScope, userId: ctxUserId } = resolved.context;

  // Same filter for mains and desserts; see spin-today for why.
  const spin = buildSpinFilter(session.user, householdId, { tags, tagMatch, favoritesOnly });

  const today = (await viewerToday());
  const remainingDays = getRemainingDaysInWeek(today);

  const filledDates: { mealType: MealType; date: string }[] = [];
  let unfilledCount = 0;
  const notes: string[] = [];

  const dessertSlot = includeDessert ? dessertSlotFor(mealTypes) : null;

  for (const mealType of mealTypes) {
    const daysToFill = remainingDays.filter((day) => {
      if (overwriteExisting) return true;
      // 'Filled' means the slot holds at least one recipe. Without
      // overwriteExisting a spin only fills empty slots, so a hand-built
      // two-recipe dinner is never quietly replaced.
      return getSlotEntries(householdId, day.date, ctxScope, ctxUserId, mealType).length === 0;
    });

    const pool = shuffle(
      getRecipePool(householdId, ctxScope, ctxUserId, mealType, "main", spin.filter)
    );
    // Reshuffled per day below, so a week of desserts is not one repeated pick.
    const dessertPool =
      mealType === dessertSlot
        ? getRecipePool(householdId, ctxScope, ctxUserId, mealType, "dessert", spin.filter)
        : [];
    if (mealType === dessertSlot && dessertPool.length === 0) {
      notes.push(noDessertsMessage(spin));
    }
    if (pool.length === 0 && daysToFill.length > 0) {
      notes.push(noMainsMessage(mealType, spin));
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
        householdId,
        today,
        date: day.date,
        scope: ctxScope,
        userId: ctxUserId,
        mealType,
        recipeIds:
          dessertPool.length > 0
            ? [recipe.id, shuffle(dessertPool)[0].id]
            : [recipe.id],
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
