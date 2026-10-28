import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { recipes, type MealType, type Recipe } from "@/db/schema";
import { getRemainingDaysInWeek } from "@/lib/dates";
import {
  dessertSlotFor,
  getRecipePool,
  getSlotEntries,
  getWeekPlan,
  setPlanEntry,
  shuffle,
} from "@/lib/plan";
import type { PlanContext } from "@/lib/planContext";
import type { SessionUser } from "@/lib/permissions";
import {
  buildSpinFilter,
  noDessertsMessage,
  noMainsMessage,
  type SpinFilterInput,
} from "@/lib/spinFilter";

/**
 * Crunch Time and Weekly Picks, independent of who asked.
 *
 * Moved out of their route handlers so the browser and the API pick meals with
 * the same code: a Home Assistant button that decides dinner should never
 * behave differently from the shake on the Plan page.
 */

interface SpinBase {
  user: SessionUser;
  context: PlanContext;
  /** Today where the person (or household) asking is. */
  today: string;
  mealTypes: MealType[];
  includeDessert: boolean;
  filter: SpinFilterInput;
  /** Extra context for the audit rows, e.g. which API token made the change. */
  auditNotes?: string | null;
}

export type SpinTodayResult =
  | { kind: "conflict"; conflicts: { mealType: MealType; currentRecipes: Recipe[] }[] }
  | {
      kind: "done";
      date: string;
      results: { mealType: MealType; recipe: { id: string; name: string } | null }[];
      note: string | null;
    };

/** Picks today's meals. Without `force`, a slot that already holds anything is a conflict. */
export function spinToday(input: SpinBase & { force: boolean }): SpinTodayResult {
  const { householdId, scope, userId } = input.context;
  const { today, mealTypes } = input;

  // Applied to desserts as well as mains. A tag filter is often a dietary one,
  // and a Vegetarian spin that adds a dessert nobody checked is not one.
  const spin = buildSpinFilter(input.user, householdId, input.filter);

  if (!input.force) {
    // A slot can hold several recipes, so a conflict names all of them.
    const conflicts: { mealType: MealType; currentRecipes: Recipe[] }[] = [];
    for (const mealType of mealTypes) {
      // Any recipe in the slot makes it a conflict; a slot with a main and a
      // dessert is just as 'already planned' as one with a single meal.
      const existingIds = getSlotEntries(householdId, today, scope, userId, mealType)
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
    if (conflicts.length > 0) return { kind: "conflict", conflicts };
  }

  const weekPlan = getWeekPlan(householdId, today, scope, userId);
  const results: { mealType: MealType; recipe: { id: string; name: string } | null }[] = [];
  const errors: string[] = [];

  // Where a dessert goes, if one was asked for.
  const dessertSlot = input.includeDessert ? dessertSlotFor(mealTypes) : null;

  for (const mealType of mealTypes) {
    // "main" so shaking for dinner never proposes cake.
    const pool = getRecipePool(householdId, scope, userId, mealType, "main", spin.filter);
    if (pool.length === 0) {
      errors.push(noMainsMessage(mealType, spin));
      results.push({ mealType, recipe: null });
      continue;
    }

    const usedThisWeek = new Set(
      weekPlan
        .filter((d) => d.date !== today)
        .flatMap((d) => d.meals[mealType].recipes.map((r) => r.recipe.id))
    );
    const unused = pool.filter((r) => !usedThisWeek.has(r.id));
    const picked = shuffle(unused.length > 0 ? unused : pool)[0];
    const recipeIds = [picked.id];

    if (mealType === dessertSlot) {
      const dessertPool = getRecipePool(householdId, scope, userId, mealType, "dessert", spin.filter);
      if (dessertPool.length === 0) {
        errors.push(noDessertsMessage(spin));
      } else {
        // Second in the slot, so the main keeps position 0 and the dessert
        // reads as following it.
        recipeIds.push(shuffle(dessertPool)[0].id);
      }
    }

    setPlanEntry({
      householdId,
      today,
      date: today,
      scope,
      userId,
      mealType,
      recipeIds,
      actingUserId: input.user.id,
      action: "spin_today",
      notes: input.auditNotes ?? null,
    });

    results.push({ mealType, recipe: { id: picked.id, name: picked.name } });
  }

  return { kind: "done", date: today, results, note: errors.length > 0 ? errors.join(" ") : null };
}

export interface SpinWeekResult {
  filledDates: { mealType: MealType; date: string }[];
  unfilledCount: number;
  note: string | null;
}

/** Fills the rest of the week, today included. Without `overwriteExisting` only empty slots are filled. */
export function spinWeek(input: SpinBase & { overwriteExisting: boolean }): SpinWeekResult {
  const { householdId, scope, userId } = input.context;
  const { today, mealTypes } = input;

  // Same filter for mains and desserts; see spinToday for why.
  const spin = buildSpinFilter(input.user, householdId, input.filter);
  const remainingDays = getRemainingDaysInWeek(today);

  const filledDates: { mealType: MealType; date: string }[] = [];
  let unfilledCount = 0;
  const notes: string[] = [];

  const dessertSlot = input.includeDessert ? dessertSlotFor(mealTypes) : null;

  for (const mealType of mealTypes) {
    const daysToFill = remainingDays.filter((day) => {
      if (input.overwriteExisting) return true;
      // 'Filled' means the slot holds at least one recipe. Without
      // overwriteExisting a spin only fills empty slots, so a hand-built
      // two-recipe dinner is never quietly replaced.
      return getSlotEntries(householdId, day.date, scope, userId, mealType).length === 0;
    });

    const pool = shuffle(getRecipePool(householdId, scope, userId, mealType, "main", spin.filter));
    // Reshuffled per day below, so a week of desserts is not one repeated pick.
    const dessertPool =
      mealType === dessertSlot
        ? getRecipePool(householdId, scope, userId, mealType, "dessert", spin.filter)
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
        scope,
        userId,
        mealType,
        recipeIds: dessertPool.length > 0 ? [recipe.id, shuffle(dessertPool)[0].id] : [recipe.id],
        actingUserId: input.user.id,
        action: "spin_week",
        notes: input.auditNotes ?? null,
      });

      filledDates.push({ mealType, date: day.date });
    });

    if (pool.length > 0 && pool.length < daysToFill.length) {
      notes.push(
        `Not enough distinct ${mealType} recipes for all remaining days — some day(s) were left unplanned.`
      );
    }
  }

  return { filledDates, unfilledCount, note: notes.length > 0 ? notes.join(" ") : null };
}
