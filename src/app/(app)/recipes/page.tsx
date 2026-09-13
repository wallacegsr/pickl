import { auth } from "@/lib/auth";
import { householdScope, isAdmin } from "@/lib/permissions";
import RecipeList from "@/components/RecipeList";
import { attachTags, listVisibleTags } from "@/lib/tags";
import { listVisibleRecipes } from "@/lib/recipes";
import { favoriteRecipeIds } from "@/lib/favorites";

export default async function RecipesPage({
  searchParams,
}: {
  searchParams?: { tag?: string };
}) {
  const session = await auth();
  const user = session!.user;
  const householdId = householdScope(user);

  // listVisibleRecipes rather than a query of its own, so this list, the export
  // and the bulk actions share one definition of which recipes a person sees.
  const visible = householdId ? listVisibleRecipes(householdId, user.id) : [];

  return (
    <div>
      <h2 className="mb-4">The Recipe Jar</h2>
      <RecipeList
        initialRecipes={householdId ? attachTags(householdId, visible) : []}
        currentUserId={user.id}
        initialTagFilter={searchParams?.tag}
        isAdmin={isAdmin(user)}
        // For the bulk "Tag…" autocomplete. Which tags exist is a permission
        // question, answered here rather than guessed at in the browser.
        existingTags={listVisibleTags(user).map((t) => t.name)}
        initialFavoriteIds={householdId ? [...favoriteRecipeIds(user, householdId)] : []}
      />
    </div>
  );
}
