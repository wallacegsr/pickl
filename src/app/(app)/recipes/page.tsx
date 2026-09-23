import { auth } from "@/lib/auth";
import { householdScope, isAdmin } from "@/lib/permissions";
import RecipeList from "@/components/RecipeList";
import { listVisibleTags } from "@/lib/tags";
import { parseRecipeQuery, queryRecipes, type RecipePage } from "@/lib/recipeQuery";

export default async function RecipesPage(
  props: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await auth();
  const user = session!.user;
  const householdId = householdScope(user);

  // The URL is the query: tab, search, filters, sort and page. The Tags page
  // links its counts here as ?tag=Name, which is simply a tag filter.
  const query = parseRecipeQuery(searchParams ?? {});
  const data: RecipePage = householdId
    ? queryRecipes(householdId, user.id, query)
    : {
        rows: [], total: 0, tabTotal: 0, page: 1, limit: query.limit,
        facets: { mealTypes: [], tags: [], favorites: 0 },
      };

  return (
    <div>
      <h2 className="mb-4">The Recipe Jar</h2>
      <RecipeList
        data={data}
        query={query}
        currentUserId={user.id}
        isAdmin={isAdmin(user)}
        // For the bulk "Tag…" autocomplete. Which tags exist is a permission
        // question, answered here rather than guessed at in the browser.
        existingTags={listVisibleTags(user).map((t) => t.name)}
      />
    </div>
  );
}
