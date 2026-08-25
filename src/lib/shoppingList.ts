import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { shoppingListStatus, type MealType, type Scope } from "@/db/schema";
import { getWeekPlan, MEAL_TYPE_LIST, ownerKey } from "@/lib/plan";
import { splitIngredients } from "@/lib/ingredients";

export interface IngredientLine {
  ingredientText: string;
  onHand: boolean;
}

export interface ShoppingListMeal {
  mealType: MealType;
  recipeId: string;
  recipeName: string;
  ingredients: IngredientLine[];
}

export interface ShoppingListDay {
  date: string;
  dayOfWeek: string;
  meals: ShoppingListMeal[];
}

// Lives in src/lib/ingredients.ts so client components can import it without
// dragging this module's database handle into the browser bundle. Re-exported
// here so existing callers keep working.
export { splitIngredients } from "@/lib/ingredients";

/**
 * Loads the on-hand status map for a given calendar (scope + owner) across
 * the given dates, keyed by `${date}|${mealType}|${ingredientText}`.
 */
export function getOnHandMap(
  scope: Scope,
  userId: string,
  dates: string[]
): Map<string, boolean> {
  const owner = ownerKey(scope, userId);
  const map = new Map<string, boolean>();
  if (dates.length === 0) return map;

  const rows = db
    .select()
    .from(shoppingListStatus)
    .where(
      and(
        eq(shoppingListStatus.scope, scope),
        eq(shoppingListStatus.userId, owner),
        inArray(shoppingListStatus.date, dates)
      )
    )
    .all();

  for (const row of rows) {
    map.set(`${row.date}|${row.mealType}|${row.ingredientText}`, row.onHand);
  }
  return map;
}

/**
 * Builds the shopping list for a calendar's whole week: one entry per day
 * that has at least one planned meal, each with a sub-list per planned meal
 * (unplanned slots are simply omitted), with each ingredient line's on-hand
 * status attached.
 */
export function buildShoppingListWeek(
  referenceDate: string,
  scope: Scope,
  userId: string
): ShoppingListDay[] {
  const weekPlan = getWeekPlan(referenceDate, scope, userId);
  const dates = weekPlan.map((d) => d.date);
  const onHandMap = getOnHandMap(scope, userId, dates);

  const days: ShoppingListDay[] = [];
  for (const day of weekPlan) {
    const meals: ShoppingListMeal[] = [];
    for (const mealType of MEAL_TYPE_LIST) {
      const slot = day.meals[mealType];
      if (!slot.recipe) continue;
      const ingredients = splitIngredients(slot.recipe.ingredients).map((ingredientText) => ({
        ingredientText,
        onHand: onHandMap.get(`${day.date}|${mealType}|${ingredientText}`) ?? false,
      }));
      meals.push({
        mealType,
        recipeId: slot.recipe.id,
        recipeName: slot.recipe.name,
        ingredients,
      });
    }
    if (meals.length > 0) {
      days.push({ date: day.date, dayOfWeek: day.dayOfWeek, meals });
    }
  }
  return days;
}

export interface SetOnHandInput {
  scope: Scope;
  userId: string; // owner of the calendar (private) — ignored for shared
  date: string;
  mealType: MealType;
  ingredientText: string;
  onHand: boolean;
  actingUserId: string;
}

/** The single write path for shopping_list_status: upserts by (scope, userId, date, mealType, ingredientText). */
export function setOnHand(input: SetOnHandInput) {
  const owner = ownerKey(input.scope, input.userId);

  const existing = db
    .select()
    .from(shoppingListStatus)
    .where(
      and(
        eq(shoppingListStatus.scope, input.scope),
        eq(shoppingListStatus.userId, owner),
        eq(shoppingListStatus.date, input.date),
        eq(shoppingListStatus.mealType, input.mealType),
        eq(shoppingListStatus.ingredientText, input.ingredientText)
      )
    )
    .get();

  if (existing) {
    db.update(shoppingListStatus)
      .set({
        onHand: input.onHand,
        updatedAt: new Date(),
        updatedByUserId: input.actingUserId,
      })
      .where(eq(shoppingListStatus.id, existing.id))
      .run();
  } else {
    db.insert(shoppingListStatus)
      .values({
        id: randomUUID(),
        scope: input.scope,
        userId: owner,
        date: input.date,
        mealType: input.mealType,
        ingredientText: input.ingredientText,
        onHand: input.onHand,
        updatedByUserId: input.actingUserId,
      })
      .run();
  }

  return { onHand: input.onHand };
}
