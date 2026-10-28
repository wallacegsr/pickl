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

/**
 * The method as steps: one per paragraph or line, with any "1." / "Step 2:"
 * numbering the author typed dropped, since the list numbers them itself.
 * Shared by the recipe page and the API, so both number a method the same way.
 */
export function splitSteps(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^(step\s*)?\d+\s*[.):-]\s*/i, ""))
    .filter(Boolean);
}
