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
  tags: string;
  ingredients: string;
}

/**
 * Matches a recipe against a free-text query, restricted to whichever of
 * name/tags/ingredients are enabled in `fields`. Shared by the /recipes list
 * and the plan page's manual recipe picker so both filter identically.
 */
export function matchesRecipeSearch(
  recipe: SearchableRecipe,
  query: string,
  fields: RecipeSearchFields
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (!fields.name && !fields.tags && !fields.ingredients) return true;

  if (fields.name && recipe.name.toLowerCase().includes(q)) return true;
  if (fields.tags && recipe.tags.toLowerCase().includes(q)) return true;
  if (fields.ingredients && recipe.ingredients.toLowerCase().includes(q)) return true;
  return false;
}
