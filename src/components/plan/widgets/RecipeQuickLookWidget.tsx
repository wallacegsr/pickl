"use client";

import { useMemo, useState } from "react";
import { Badge, Form, ListGroup } from "react-bootstrap";
import type { MealType } from "@/db/schema";
import RecipeSearchBar from "@/components/RecipeSearchBar";
import { splitIngredients } from "@/lib/ingredients";
import {
  DEFAULT_RECIPE_SEARCH_FIELDS,
  matchesRecipeSearch,
  type RecipeSearchFields,
} from "@/lib/recipeSearch";
import type { RecipeOption } from "@/components/PlanView";
import { usePlanContext } from "../PlanContext";

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

/**
 * A glance, not a second /recipes page.
 *
 * Two things only: what is planned for tonight (with its ingredients), and a
 * search box for rummaging in the jar. Deliberately capped at a handful of
 * results with no detail view, no editing and no links out of the flow — the
 * moment this grows a "show more" it stops being something you can fit in a
 * quarter of the board.
 *
 * It adds no server round-trip of its own. Both halves are computed from
 * data /plan already loads: `days` for what is planned, and
 * `recipePoolByMeal` — the pool the manual slot editor already uses — for
 * the ingredient text. Matching goes through matchesRecipeSearch so this box
 * filters identically to the recipes list and the slot picker.
 */
const MAX_RESULTS = 6;

export default function RecipeQuickLookWidget() {
  const { days, today, recipePoolByMeal } = usePlanContext();
  const [query, setQuery] = useState("");
  const [fields, setFields] = useState<RecipeSearchFields>(
    DEFAULT_RECIPE_SEARCH_FIELDS
  );

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
  const tonight = tonightSlot?.recipe
    ? allRecipes.find((r) => r.id === tonightSlot.recipe!.id) ?? null
    : null;
  // The pool is scoped to this calendar; if a recipe was planned and has
  // since gone private or been deleted, fall back to the name the plan
  // itself carries rather than showing nothing.
  const tonightName = tonightSlot?.recipe?.name ?? null;

  const trimmed = query.trim();
  const results = useMemo(() => {
    if (!trimmed) return [];
    return allRecipes
      .filter((r) => matchesRecipeSearch(r, trimmed, fields))
      .slice(0, MAX_RESULTS);
  }, [allRecipes, trimmed, fields]);

  const matchCount = trimmed
    ? allRecipes.filter((r) => matchesRecipeSearch(r, trimmed, fields)).length
    : 0;

  return (
    <div className="d-flex flex-column gap-3">
      <section aria-label="Tonight's dinner">
        <div className="text-uppercase small text-body-secondary fw-semibold">
          Tonight — {MEAL_LABELS.dinner}
        </div>
        {tonightName ? (
          <>
            <div className="fw-semibold">{tonightName}</div>
            {tonight && tonight.tags.trim() && (
              <div className="mt-1">
                {tonight.tags
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean)
                  .map((tag) => (
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

      <section aria-label="Search the jar">
        <Form.Label
          htmlFor="quick-look-search"
          className="text-uppercase small text-body-secondary fw-semibold mb-1"
        >
          Search the jar
        </Form.Label>
        <RecipeSearchBar
          controlId="quick-look-search"
          idPrefix="quick-look"
          query={query}
          onQueryChange={setQuery}
          fields={fields}
          onFieldsChange={setFields}
          placeholder="Name, tag, or ingredient..."
          size="sm"
        />
        {trimmed && (
          <div className="mt-2">
            {results.length === 0 ? (
              <div className="small text-body-secondary">
                Nothing in the jar matches that.
              </div>
            ) : (
              <>
                <ListGroup variant="flush" className="small">
                  {results.map((recipe) => (
                    <ListGroup.Item key={recipe.id} className="px-0 py-1">
                      <span className="fw-semibold">{recipe.name}</span>
                      {recipe.tags.trim() && (
                        <span className="text-body-secondary"> · {recipe.tags}</span>
                      )}
                    </ListGroup.Item>
                  ))}
                </ListGroup>
                {matchCount > results.length && (
                  <div className="small text-body-secondary mt-1">
                    +{matchCount - results.length} more match — narrow the search.
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
