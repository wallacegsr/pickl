import type { SessionUser } from "@/lib/permissions";
import { favoriteRecipeIds } from "@/lib/favorites";
import type { RecipePoolFilter } from "@/lib/plan";

/**
 * The spin controls' tag and favourites filters, turned into a pool filter
 * and a description of it for the messages the spin returns.
 *
 * The description is the reason this lives in one place. Once a spin can be
 * narrowed, "No eligible recipes for dinner" stops being a useful thing to
 * say: the jar may be full of dinners, none of them starred. Both spin
 * endpoints need to say which filter emptied the pool, and in the same words.
 */

export interface SpinFilterInput {
  tags: string[];
  tagMatch: "any" | "all";
  favoritesOnly: boolean;
}

export interface SpinFilter {
  filter: RecipePoolFilter;
  /** e.g. "starred and tagged Vegetarian and Quick", or "" when unfiltered. */
  description: string;
  active: boolean;
}

export function buildSpinFilter(
  user: SessionUser,
  householdId: string,
  input: SpinFilterInput
): SpinFilter {
  const tags = [...new Set(input.tags.map((t) => t.trim()).filter(Boolean))];

  const filter: RecipePoolFilter = {};
  const parts: string[] = [];

  if (input.favoritesOnly) {
    // The spinner's own stars, even on the shared calendar: a favourites-only
    // spin means "from what I've starred", and the stars on screen are theirs.
    filter.onlyIds = favoriteRecipeIds(user, householdId);
    parts.push("starred");
  }

  if (tags.length > 0) {
    filter.tags = tags;
    filter.tagMatch = input.tagMatch;
    const joiner = input.tagMatch === "any" ? " or " : " and ";
    parts.push(`tagged ${tags.join(joiner)}`);
  }

  return {
    filter,
    description: parts.join(" and "),
    active: parts.length > 0,
  };
}

/** The empty-pool message for a meal, naming the filter when there is one. */
export function noMainsMessage(mealType: string, spin: SpinFilter): string {
  return spin.active
    ? `No ${mealType} recipes are ${spin.description}.`
    : `No eligible recipes for ${mealType}.`;
}

/** The empty-pool message for desserts, naming the filter when there is one. */
export function noDessertsMessage(spin: SpinFilter): string {
  return spin.active
    ? `No desserts are ${spin.description}, so none was added.`
    : "No recipes are tagged as desserts yet.";
}
