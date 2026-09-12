import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { recipes, type Recipe } from "@/db/schema";
import { attachTagsToRecipe, parseTagInput, setRecipeTags } from "@/lib/tags";
import type { recipeSchema } from "@/lib/validators";
import type { z } from "zod";

/**
 * The one place a recipe row is written.
 *
 * Extracted from POST /api/recipes when import arrived, rather than letting
 * the importer grow an insert of its own. Two write paths for the same table
 * is how "dessert" ended up storable by the form and rejected by the API, and
 * how tags could be created without going through household-aware matching.
 */

export type RecipeInput = z.infer<typeof recipeSchema>;

export interface CreateRecipeOptions {
  householdId: string;
  actingUserId: string;
  data: RecipeInput;
}

export function createRecipe({ householdId, actingUserId, data }: CreateRecipeOptions) {
  const id = randomUUID();

  db.insert(recipes)
    .values({
      id,
      householdId,
      name: data.name,
      ingredients: data.ingredients,
      instructions: data.instructions,
      prepTimeMinutes: data.prepTimeMinutes ?? null,
      cookTimeMinutes: data.cookTimeMinutes ?? null,
      servings: data.servings ?? null,
      sourceUrl: data.sourceUrl || null,
      notes: data.notes || null,
      visibility: data.visibility,
      // A shared recipe belongs to the household rather than to whoever typed
      // it, which is what lets an admin edit it later.
      ownerUserId: data.visibility === "private" ? actingUserId : null,
      mealType: data.mealType.join(","),
      createdByUserId: actingUserId,
    })
    .run();

  setRecipeTags(householdId, id, parseTagInput(data.tags ?? ""), actingUserId);

  const created = db
    .select()
    .from(recipes)
    .where(and(eq(recipes.id, id), eq(recipes.householdId, householdId)))
    .get();

  return created ? attachTagsToRecipe(householdId, created) : null;
}

/**
 * Every recipe in the household this user can read: the shared pool plus
 * their own private ones.
 *
 * The same rule as the recipe list and the export, in one function so the
 * three cannot disagree about what "visible" means.
 */
export function listVisibleRecipes(householdId: string, userId: string): Recipe[] {
  return db
    .select()
    .from(recipes)
    .where(
      and(
        eq(recipes.householdId, householdId),
        or(eq(recipes.visibility, "shared"), eq(recipes.ownerUserId, userId))
      )
    )
    .orderBy(desc(recipes.createdAt))
    .all();
}

/**
 * Which of these source URLs the household already has, as a set.
 *
 * `sourceUrl` is the only field that identifies a recipe rather than merely
 * describing it, which is why duplicate detection uses it and nothing else.
 * Matching on name would refuse the second "Chicken Soup" a household is
 * perfectly entitled to have.
 *
 * Unscoped by visibility on purpose: the question is whether the household
 * already holds this recipe, and a private copy someone else owns still
 * counts — otherwise an import creates a duplicate its owner cannot see.
 */
export function existingSourceUrls(
  householdId: string,
  urls: string[]
): Set<string> {
  const wanted = urls.filter(Boolean);
  if (wanted.length === 0) return new Set();

  const rows = db
    .select({ sourceUrl: recipes.sourceUrl })
    .from(recipes)
    .where(and(eq(recipes.householdId, householdId), inArray(recipes.sourceUrl, wanted)))
    .all();

  return new Set(rows.map((r) => r.sourceUrl).filter((u): u is string => Boolean(u)));
}
