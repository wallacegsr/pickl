import { createHash } from "node:crypto";
import type { MealType, Recipe } from "@/db/schema";
import { getAppBaseUrl } from "@/lib/appUrl";
import { MEAL_TYPE_LIST, type PlanDay } from "@/lib/plan";
import type { ShoppingListDay } from "@/lib/shoppingList";
import type { ShoppingExtra } from "@/lib/shoppingExtras";

/**
 * The JSON shapes /api/v1 promises. snake_case, flat, and small: Home
 * Assistant reads these with templates and stores attributes on every update,
 * so a field name should read well in YAML and nothing should be sent that a
 * sensor would not use.
 */

export interface ApiRecipeSummary {
  id: string;
  name: string;
  is_dessert: boolean;
  prep_minutes: number | null;
  cook_minutes: number | null;
  total_minutes: number | null;
  servings: number | null;
  url: string;
}

export function recipeUrl(id: string): string {
  return `${getAppBaseUrl()}/recipes/${encodeURIComponent(id)}`;
}

export function totalMinutes(recipe: Pick<Recipe, "prepTimeMinutes" | "cookTimeMinutes">): number | null {
  const { prepTimeMinutes: prep, cookTimeMinutes: cook } = recipe;
  return prep == null && cook == null ? null : (prep ?? 0) + (cook ?? 0);
}

export function recipeSummary(recipe: Recipe, isDessert: boolean): ApiRecipeSummary {
  return {
    id: recipe.id,
    name: recipe.name,
    is_dessert: isDessert,
    prep_minutes: recipe.prepTimeMinutes,
    cook_minutes: recipe.cookTimeMinutes,
    total_minutes: totalMinutes(recipe),
    servings: recipe.servings,
    url: recipeUrl(recipe.id),
  };
}

export type ApiDayMeals = Record<MealType, ApiRecipeSummary[]>;

export function dayMeals(day: PlanDay): ApiDayMeals {
  const meals = {} as ApiDayMeals;
  for (const mealType of MEAL_TYPE_LIST) {
    meals[mealType] = day.meals[mealType].recipes.map((r) => recipeSummary(r.recipe, r.isDessert));
  }
  return meals;
}

/** "Tomato Soup", "Chilli & Brownies", or null: one line for a sensor's state. */
export function slotTitle(recipes: ApiRecipeSummary[]): string | null {
  if (recipes.length === 0) return null;
  return recipes.map((r) => r.name).join(" & ");
}

/**
 * A recipe line's id: its date, then a hash of what identifies it. Stable for
 * as long as the line exists, short enough for a URL, and not something a
 * caller can forge into a line that isn't there — the API rebuilds the week
 * and looks for it.
 */
export function lineItemId(date: string, mealType: string, recipeId: string, text: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([date, mealType, recipeId, text]))
    .digest("base64url")
    .slice(0, 16);
  return `r_${date}_${digest}`;
}

export function extraItemId(id: string): string {
  return `x_${id}`;
}

export interface ApiShoppingItem {
  id: string;
  text: string;
  on_hand: boolean;
  /** "recipe" lines come from the plan; "extra" ones were added by hand. */
  source: "recipe" | "extra";
  date: string | null;
  meal_type: MealType | null;
  recipe: { id: string; name: string } | null;
}

export function shoppingItems(days: ShoppingListDay[], extras: ShoppingExtra[]): ApiShoppingItem[] {
  const items: ApiShoppingItem[] = [];
  for (const day of days) {
    for (const meal of day.meals) {
      for (const ing of meal.ingredients) {
        items.push({
          id: lineItemId(day.date, meal.mealType, meal.recipeId, ing.ingredientText),
          text: ing.ingredientText,
          on_hand: ing.onHand,
          source: "recipe",
          date: day.date,
          meal_type: meal.mealType,
          recipe: { id: meal.recipeId, name: meal.recipeName },
        });
      }
    }
  }
  for (const extra of extras) {
    items.push({
      id: extraItemId(extra.id),
      text: extra.text,
      on_hand: extra.onHand,
      source: "extra",
      date: null,
      meal_type: null,
      recipe: null,
    });
  }
  return items;
}
