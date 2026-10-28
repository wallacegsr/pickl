import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { parseRecipeMealTypes, recipes } from "@/db/schema";
import { apiError, apiJson, withApi } from "@/lib/api/v1";
import { recipeUrl, totalMinutes } from "@/lib/api/serialize";
import { splitIngredients, splitSteps } from "@/lib/ingredients";
import { attachTagsToRecipe } from "@/lib/tags";

/**
 * One recipe, laid out to cook from: ingredients one per line and the method
 * as numbered steps, split exactly as the recipe page splits them — so "read
 * me step 3" means the same step on the speaker as on the screen.
 *
 * Someone else's Secret Stash recipe is "not found", not "forbidden": the API
 * does not confirm a private recipe exists to anyone who may not see it.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  return withApi(req, "read", (principal) => {
    const recipe = db
      .select()
      .from(recipes)
      .where(and(eq(recipes.id, id), eq(recipes.householdId, principal.householdId)))
      .get();
    if (!recipe || (recipe.visibility === "private" && recipe.ownerUserId !== principal.user.id)) {
      return apiError(404, "Recipe not found.");
    }

    return apiJson({
      id: recipe.id,
      name: recipe.name,
      jar: recipe.visibility === "private" ? "mine" : "shared",
      meal_types: parseRecipeMealTypes(recipe.mealType),
      tags: attachTagsToRecipe(principal.householdId, recipe).tags,
      prep_minutes: recipe.prepTimeMinutes,
      cook_minutes: recipe.cookTimeMinutes,
      total_minutes: totalMinutes(recipe),
      servings: recipe.servings,
      ingredients: splitIngredients(recipe.ingredients),
      steps: splitSteps(recipe.instructions),
      source_url: recipe.sourceUrl || null,
      url: recipeUrl(recipe.id),
    });
  });
}
