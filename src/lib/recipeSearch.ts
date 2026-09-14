export interface RecipeSearchFields {
  name: boolean;
  tags: boolean;
  ingredients: boolean;
}

export const DEFAULT_RECIPE_SEARCH_FIELDS: RecipeSearchFields = {
  name: true,
  tags: true,
  ingredients: true,
};

export interface SearchableRecipe {
  name: string;
  /** Tag names, as attached by src/lib/tags.ts. */
  tags: string[];
  ingredients: string;
  /**
   * The stored comma-separated meal types, e.g. "dinner,dessert".
   *
   * Required rather than optional so the compiler finds every search box that
   * forgot to pass it. Optional would have let the plan page's picker quietly
   * keep the bug this field was added to fix.
   */
  mealType: string;
}

/**
 * The words a meal type can be searched by: its stored value, and the label
 * the recipe form shows for it when that says something the value does not.
 *
 * Only "any" needs the second one. The others are the value capitalised,
 * which case-insensitive matching already covers — but someone who has only
 * ever seen the form's "Any meal" checkbox will reasonably type "any meal".
 */
function mealTypeTerms(stored: string): string[] {
  return stored
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .map((value) => (value === "any" ? "any meal" : value));
}

/**
 * Matches a recipe against a free-text query, restricted to whichever of
 * name/tags/ingredients are enabled in `fields`. Shared by the /recipes list
 * and the plan page's manual recipe picker so both filter identically.
 *
 * Meal types count as tags. They sit in the same row of badges on a recipe
 * card and look just like one, so a person searching "dessert" with Tag ticked
 * expects to find desserts — and did not, because meal types are stored in
 * their own column rather than as tag rows.
 *
 * Matched against what the badge SAYS, not what the recipe can be planned
 * for: a recipe marked "any" does not match a search for "dinner", even though
 * it is eligible for a dinner slot. The search box is for finding what you can
 * see; working out eligibility is the plan page's job, and it already does.
 */
/**
 * A search box's text as separate terms: split on commas and semicolons,
 * trimmed, blanks dropped. "chicken thighs, orzo" is two terms, and a recipe
 * has to match both.
 */
export function splitSearchTerms(query: string): string[] {
  return query
    .split(/[,;]/)
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
}

export function matchesRecipeSearch(
  recipe: SearchableRecipe,
  query: string,
  fields: RecipeSearchFields
): boolean {
  const terms = splitSearchTerms(query);
  if (terms.length === 0) return true;
  if (!fields.name && !fields.tags && !fields.ingredients) return true;
  return terms.every((term) => matchesTerm(recipe, term, fields));
}

function matchesTerm(recipe: SearchableRecipe, q: string, fields: RecipeSearchFields): boolean {
  if (fields.name && recipe.name.toLowerCase().includes(q)) return true;
  if (
    fields.tags &&
    (recipe.tags.some((tag) => tag.toLowerCase().includes(q)) ||
      mealTypeTerms(recipe.mealType).some((term) => term.includes(q)))
  )
    return true;
  if (fields.ingredients && recipe.ingredients.toLowerCase().includes(q)) return true;
  return false;
}
