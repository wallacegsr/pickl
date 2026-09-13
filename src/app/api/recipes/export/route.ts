import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { householdScope } from "@/lib/permissions";
import { listVisibleRecipes } from "@/lib/recipes";
import { getTagsForRecipes } from "@/lib/tags";
import { parseRecipeMealTypes } from "@/db/schema";
import { APP_VERSION } from "@/lib/version";
import { db } from "@/db";
import { recipes as recipesTable } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { matchingRecipeIds, parseRecipeQuery } from "@/lib/recipeQuery";

/**
 * Exports the household's recipes in the shape the importer takes.
 *
 * Round-trip is the whole point: what comes out of here goes back into
 * `POST /api/recipes/import` unchanged, which is what makes this a backup and
 * a way to move recipes between households rather than a report.
 *
 * So it emits the fields `recipeSchema` accepts and NOTHING else — no ids, no
 * householdId, no timestamps, no owner. Those describe where a recipe lives
 * rather than what it is, and re-importing them would either be ignored or,
 * worse, carry one household's identifiers into another.
 *
 * Scoped to what the reader can see: the shared pool plus their own private
 * recipes. Another member's private recipes are not theirs to take a copy of.
 *
 * With no parameters it exports all of that — both tabs, every page. With
 * `?matching=1` plus the Recipes page's own query parameters (tab, q, tag,
 * meal…) it exports just what that search finds, resolved by the same
 * function the list uses, so it is the list's results on every page and not
 * only the page on screen.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const householdId = householdScope(session.user);
  if (!householdId) {
    return NextResponse.json(
      { error: "This account is not part of a household." },
      { status: 403 }
    );
  }

  const search = req.nextUrl.searchParams;
  const matching = search.get("matching") === "1";
  let rows = listVisibleRecipes(householdId, session.user.id);
  if (matching) {
    const params: Record<string, string[]> = {};
    search.forEach((value, key) => {
      (params[key] ??= []).push(value);
    });
    const ids = matchingRecipeIds(householdId, session.user.id, parseRecipeQuery(params));
    rows = ids.length
      ? db.select().from(recipesTable).where(inArray(recipesTable.id, ids)).all()
      : [];
    rows.sort((a, b) => a.name.localeCompare(b.name));
  }
  const tags = getTagsForRecipes(
    householdId,
    rows.map((r) => r.id)
  );

  const recipes = rows.map((r) => ({
    name: r.name,
    ingredients: r.ingredients,
    instructions: r.instructions,
    prepTimeMinutes: r.prepTimeMinutes,
    cookTimeMinutes: r.cookTimeMinutes,
    servings: r.servings,
    sourceUrl: r.sourceUrl ?? "",
    notes: r.notes ?? "",
    visibility: r.visibility,
    // Through the schema helper rather than a raw split, so the stored
    // comma-separated form is read the same way everywhere.
    mealType: parseRecipeMealTypes(r.mealType),
    tags: tags.get(r.id) ?? [],
  }));

  const body = {
    // Wrapped rather than a bare array so the file can say what wrote it. The
    // importer accepts either, so neither shape is a trap.
    pickl: { version: APP_VERSION, exportedAt: new Date().toISOString() },
    recipes,
  };

  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(JSON.stringify(body, null, 2) + "\n", {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Served as a download rather than rendered: a blob: URL never reaches
      // the Android shell's DownloadListener, so the shell would silently do
      // nothing. Same reasoning as the shopping-list export.
      "Content-Disposition": `attachment; filename="pickl-recipes-${matching ? "filtered-" : ""}${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
