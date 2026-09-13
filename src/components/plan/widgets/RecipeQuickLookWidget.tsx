"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "react-bootstrap";
import type { MealType } from "@/db/schema";
import { splitIngredients } from "@/lib/ingredients";
import type { PlanDayData, RecipeOption } from "@/components/PlanView";
import { usePlanContext } from "../PlanContext";

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

/**
 * When each meal counts as over, in minutes after midnight, local time. Pickl
 * has no meal times, so these are sensible defaults: breakfast is "next"
 * until mid-morning, lunch until mid-afternoon, dinner until late evening.
 */
const MEAL_OVER_AT: Record<MealType, number> = {
  breakfast: 10 * 60 + 30,
  lunch: 15 * 60,
  dinner: 21 * 60,
};
const MEAL_ORDER: MealType[] = ["breakfast", "lunch", "dinner"];

/** How often to re-check which meal is next, so an open page moves on. */
const RECHECK_MS = 60_000;

/**
 * The first planned meal that isn't over yet: the rest of today, then the
 * following days of the week on screen. Empty slots are skipped, so an
 * unplanned lunch doesn't hide the dinner that is planned.
 */
export function nextPlannedMeal(days: PlanDayData[], today: string, minutesNow: number) {
  for (const day of days) {
    if (day.date < today) continue;
    for (const meal of MEAL_ORDER) {
      if (day.date === today && minutesNow >= MEAL_OVER_AT[meal]) continue;
      const first = day.meals[meal]?.recipes[0];
      if (first) return { day, meal, planned: first };
    }
  }
  return null;
}

export function whenLabel(date: string, today: string, meal: MealType, dayOfWeek: string): string {
  const tomorrow = new Date(`${today}T12:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  const tomorrowStr = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
  if (date === today) return meal === "dinner" ? "Tonight" : "Today";
  if (date === tomorrowStr) return "Tomorrow";
  return dayOfWeek;
}

/**
 * A glance at the next meal: whichever planned meal comes up next, with its
 * tags and ingredients. Nothing else — searching the jar is the Recipes
 * page's job.
 *
 * It adds no server round-trip of its own: `days` says what is planned, and
 * `recipePoolByMeal` — the pool the manual slot editor already uses — has
 * the ingredient text.
 */
export default function RecipeQuickLookWidget() {
  const { days, today, recipePoolByMeal } = usePlanContext();

  // The clock is read after mount, not during render: the server's time and
  // timezone are not the viewer's, and rendering with them would disagree
  // with the browser. Until then, treat it as the start of the day.
  const [minutesNow, setMinutesNow] = useState(0);
  useEffect(() => {
    const read = () => {
      const now = new Date();
      setMinutesNow(now.getHours() * 60 + now.getMinutes());
    };
    read();
    const timer = window.setInterval(read, RECHECK_MS);
    return () => window.clearInterval(timer);
  }, []);

  /** Every recipe eligible for any meal on this calendar, deduped by id. */
  const allRecipes = useMemo(() => {
    const byId = new Map<string, RecipeOption>();
    for (const pool of Object.values(recipePoolByMeal)) {
      for (const recipe of pool) if (!byId.has(recipe.id)) byId.set(recipe.id, recipe);
    }
    return [...byId.values()];
  }, [recipePoolByMeal]);

  const next = nextPlannedMeal(days, today, minutesNow);
  // The first recipe in the slot is the one worth surfacing: a dessert or a
  // second main is detail the grid already shows.
  const recipe = next ? allRecipes.find((r) => r.id === next.planned.recipe.id) ?? null : null;
  const viewingThisWeek = days.some((d) => d.date === today);

  return (
    <section aria-label="Next meal">
      {next ? (
        <>
          <div className="text-uppercase small text-body-secondary fw-semibold">
            {whenLabel(next.day.date, today, next.meal, next.day.dayOfWeek)} — {MEAL_LABELS[next.meal]}
          </div>
          {/* The pool is scoped to this calendar; if a planned recipe has since
              gone private or been deleted, the plan still carries its name. */}
          <Link
            href={`/recipes/${next.planned.recipe.id}`}
            className="fw-semibold link-body-emphasis d-inline-block"
            title="Open the recipe"
          >
            {next.planned.recipe.name} →
          </Link>
          {recipe && recipe.tags.length > 0 && (
            <div className="mt-1">
              {recipe.tags.map((tag) => (
                <Badge key={tag} bg="dark" className="recipe-tag-badge text-bg-dark">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
          {recipe ? (
            <ul className="small mb-0 mt-2 ps-3">
              {splitIngredients(recipe.ingredients).map((line) => (
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
        <>
          <div className="text-uppercase small text-body-secondary fw-semibold">Next meal</div>
          <div className="text-muted fst-italic">
            {viewingThisWeek || days.some((d) => d.date > today)
              ? "Nothing else planned this week — the jar's still shut."
              : "This week is over. Switch to the current week to see what's next."}
          </div>
        </>
      )}
    </section>
  );
}
