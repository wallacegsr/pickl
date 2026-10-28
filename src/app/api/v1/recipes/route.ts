import { NextRequest } from "next/server";
import { apiJson, withApi } from "@/lib/api/v1";
import { recipeUrl, totalMinutes } from "@/lib/api/serialize";
import { parseRecipeMealTypes } from "@/db/schema";
import { queryRecipes } from "@/lib/recipeQuery";
import { parseRecipeQuery } from "@/lib/recipeQueryParams";

/** The most a single request may list. A dropdown or a voice answer needs far fewer. */
const MAX_LIMIT = 50;

/**
 * Recipe search, compact, with the same matching as the Recipes page:
 *
 *   q            search text; several terms separated by commas must all match
 *   tag          a tag; repeat for several (all must match unless match=any)
 *   meal         breakfast, lunch, dinner or dessert
 *   favorites=1  only your starred recipes
 *   max_minutes  prep + cook time at most this
 *   jar          "shared" (the House Jar, default) or "mine" (your Secret Stash)
 *   limit        default 20, at most 50
 */
export function GET(req: NextRequest) {
  return withApi(req, "read", (principal) => {
    const p = req.nextUrl.searchParams;
    const limit = Math.min(Math.max(Number(p.get("limit")) || 20, 1), MAX_LIMIT);
    const query = parseRecipeQuery({
      tab: p.get("jar") === "mine" ? "mine" : "shared",
      q: p.get("q") ?? undefined,
      tag: p.getAll("tag"),
      match: p.get("match") ?? undefined,
      meal: p.getAll("meal"),
      fav: p.get("favorites") === "1" || p.get("favorites") === "true" ? "1" : undefined,
      max: p.get("max_minutes") ?? undefined,
      limit: String(limit),
    });

    const page = queryRecipes(principal.householdId, principal.user.id, query);
    return apiJson({
      total: page.total,
      count: page.rows.length,
      recipes: page.rows.map((row) => ({
        id: row.id,
        name: row.name,
        meal_types: parseRecipeMealTypes(row.mealType),
        tags: row.tags,
        favorite: row.isFavorite,
        total_minutes: totalMinutes(row),
        last_planned: row.lastPlanned,
        url: recipeUrl(row.id),
      })),
    });
  });
}
