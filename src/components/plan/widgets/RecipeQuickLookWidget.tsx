"use client";

import { useMemo } from "react";
import { Badge } from "react-bootstrap";
import type { MealType } from "@/db/schema";
import { splitIngredients } from "@/lib/ingredients";
import type { RecipeOption } from "@/components/PlanView";
import { usePlanContext } from "../PlanContext";

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

/**
 * A glance at tonight's recipe: what is planned for dinner, its tags and its
 * ingredients. Nothing else — searching the jar is the Recipes page's job.
 *
 * It adds no server round-trip of its own: `days` says what is planned, and
 * `recipePoolByMeal` — the pool the manual slot editor already uses — has
 * the ingredient text.
 */

export default function RecipeQuickLookWidget() {
  const { days, today, recipePoolByMeal } = usePlanContext();

  /** Every recipe eligible for any meal on this calendar, deduped by id. */
  const allRecipes = useMemo(() => {
    const byId = new Map<string, RecipeOption>();
    for (const pool of Object.values(recipePoolByMeal)) {
      for (const recipe of pool) if (!byId.has(recipe.id)) byId.set(recipe.id, recipe);
    }
    return [...byId.values()];
  }, [recipePoolByMeal]);

  const todayDay = days.find((d) => d.date === today) ?? null;
  const tonightSlot = todayDay?.meals.dinner ?? null;
  // The first recipe in the slot is the one worth surfacing here: this widget
  // answers "what am I cooking tonight", and a dessert or a second main is
  // detail the grid already shows.
  const tonightPlanned = tonightSlot?.recipes[0] ?? null;
  const tonight = tonightPlanned
    ? allRecipes.find((r) => r.id === tonightPlanned.recipe.id) ?? null
    : null;
  // The pool is scoped to this calendar; if a recipe was planned and has
  // since gone private or been deleted, fall back to the name the plan
  // itself carries rather than showing nothing.
  const tonightName = tonightPlanned?.recipe.name ?? null;


  return (
    <div>
      <section aria-label="Tonight's dinner">
        <div className="text-uppercase small text-body-secondary fw-semibold">
          Tonight — {MEAL_LABELS.dinner}
        </div>
        {tonightName ? (
          <>
            <div className="fw-semibold">{tonightName}</div>
            {tonight && tonight.tags.length > 0 && (
              <div className="mt-1">
                {tonight.tags.map((tag) => (
                  <Badge
                    key={tag}
                    bg="dark"
                    className="recipe-tag-badge text-bg-dark"
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
            {tonight ? (
              <ul className="small mb-0 mt-2 ps-3">
                {splitIngredients(tonight.ingredients).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              <div className="small text-body-secondary mt-1">
                Ingredients aren&apos;t available for this recipe here.
              </div>
            )}
          </>
        ) : (
          <div className="text-muted fst-italic">
            Nothing planned for dinner yet — the jar&apos;s still shut.
          </div>
        )}
      </section>
    </div>
  );
}
