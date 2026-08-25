/**
 * Pure ingredient-text helpers.
 *
 * Split out of src/lib/shoppingList.ts so that client components can use them
 * without pulling that module's `@/db` import — and therefore better-sqlite3
 * and google-auth-library — into the browser bundle. shoppingList.ts
 * re-exports splitIngredients, so every existing server-side caller is
 * unaffected.
 */

/** Splits a recipe's free-text ingredients field into non-empty lines, matching RecipeForm's "one per line" convention. */
export function splitIngredients(ingredients: string): string[] {
  return ingredients
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
