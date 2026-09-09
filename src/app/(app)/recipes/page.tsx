import { and, desc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { recipes } from "@/db/schema";
import { auth } from "@/lib/auth";
import { householdScope, isAdmin } from "@/lib/permissions";
import RecipeList from "@/components/RecipeList";
import { attachTags } from "@/lib/tags";

export default async function RecipesPage({
  searchParams,
}: {
  searchParams?: { tag?: string };
}) {
  const session = await auth();
  const userId = session!.user.id;
  const householdId = householdScope(session?.user);

  const allRecipes = householdId
    ? db
        .select()
        .from(recipes)
        .where(
          and(
            eq(recipes.householdId, householdId),
            or(eq(recipes.visibility, "shared"), eq(recipes.ownerUserId, userId))
          )
        )
        .orderBy(desc(recipes.createdAt))
        .all()
    : [];

  return (
    <div>
      <h2 className="mb-4">The Recipe Jar</h2>
      <RecipeList
        initialRecipes={householdId ? attachTags(householdId, allRecipes) : []}
        currentUserId={userId}
        initialTagFilter={searchParams?.tag}
        isAdmin={isAdmin(session?.user)}
      />
    </div>
  );
}
