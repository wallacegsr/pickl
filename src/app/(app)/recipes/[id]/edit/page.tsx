import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { recipes } from "@/db/schema";
import { auth } from "@/lib/auth";
import { canEditRecipe, householdScope, isAdmin } from "@/lib/permissions";
import RecipeForm from "@/components/RecipeForm";
import { attachTagsToRecipe, listVisibleTags } from "@/lib/tags";

export default async function EditRecipePage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  const householdId = householdScope(session?.user);
  if (!householdId) notFound();

  // Household in the WHERE clause, not a check afterwards: another family's
  // shared recipe would pass canEditRecipe for an admin.
  const recipe = db
    .select()
    .from(recipes)
    .where(and(eq(recipes.id, params.id), eq(recipes.householdId, householdId)))
    .get();

  if (!recipe) {
    notFound();
  }

  if (!canEditRecipe(session?.user, recipe)) {
    notFound();
  }

  // Names only: the autocomplete has no use for usage counts, and
  // listVisibleTags is what decides which tags this user may see at all —
  // reimplementing that rule here could suggest a tag that exists only on
  // someone else's private recipe.
  const existingTags = session?.user
    ? listVisibleTags(session.user).map((t) => t.name)
    : [];

  return (
    <div>
      <h2 className="mb-4">Edit Recipe</h2>
      <RecipeForm
        recipe={attachTagsToRecipe(householdId, recipe)}
        recipeId={params.id}
        isAdmin={isAdmin(session?.user)}
        existingTags={existingTags}
      />
    </div>
  );
}
