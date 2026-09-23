import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { householdScope } from "@/lib/permissions";
import { matchingRecipeIds, parseRecipeQuery, queryRecipes } from "@/lib/recipeQuery";

/**
 * One page of recipes, with counts, for the same URL parameters the Recipes
 * page takes (tab, q, in, meal, tag, match, fav, max, sort, page, limit).
 *
 * For pickers that need to search the jar without loading all of it — the
 * Tags page's "Recipes…" dialog, for one.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const householdId = householdScope(session.user);
  const params: Record<string, string[]> = {};
  req.nextUrl.searchParams.forEach((value, key) => {
    (params[key] ??= []).push(value);
  });
  const query = parseRecipeQuery(params);
  if (!householdId) {
    return NextResponse.json({
      rows: [], total: 0, tabTotal: 0, page: 1, limit: query.limit,
      facets: { mealTypes: [], tags: [], favorites: 0 },
    });
  }
  // `?ids=1`: only which recipes match, not the rows. For the slot picker,
  // which already has every recipe's name and needs only to know which ones
  // a search reaches through their ingredients.
  if (req.nextUrl.searchParams.get("ids") === "1") {
    return NextResponse.json({ ids: matchingRecipeIds(householdId, session.user.id, query) });
  }
  return NextResponse.json(queryRecipes(householdId, session.user.id, query));
}
