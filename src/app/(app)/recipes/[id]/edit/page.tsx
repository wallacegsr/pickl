import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { recipes } from "@/db/schema";
import { auth } from "@/lib/auth";
import { canEditRecipe, isAdmin } from "@/lib/permissions";
import RecipeForm from "@/components/RecipeForm";

export default async function EditRecipePage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  const recipe = db
    .select()
    .from(recipes)
    .where(eq(recipes.id, params.id))
    .get();

  if (!recipe) {
    notFound();
  }

  if (!canEditRecipe(session?.user, recipe)) {
    notFound();
  }

  return (
    <div>
      <h2 className="mb-4">Edit Recipe</h2>
      <RecipeForm recipe={recipe} recipeId={params.id} isAdmin={isAdmin(session?.user)} />
    </div>
  );
}
