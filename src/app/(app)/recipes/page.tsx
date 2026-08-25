import { desc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { recipes } from "@/db/schema";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import RecipeList from "@/components/RecipeList";

export default async function RecipesPage() {
  const session = await auth();
  const userId = session!.user.id;

  const allRecipes = db
    .select()
    .from(recipes)
    .where(or(eq(recipes.visibility, "shared"), eq(recipes.ownerUserId, userId)))
    .orderBy(desc(recipes.createdAt))
    .all();

  return (
    <div>
      <h2 className="mb-4">The Recipe Jar</h2>
      <RecipeList
        initialRecipes={allRecipes}
        currentUserId={userId}
        isAdmin={isAdmin(session?.user)}
      />
    </div>
  );
}
