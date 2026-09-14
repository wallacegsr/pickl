import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { planEntries, recipeFavorites, recipes, recipeTags, tags } from "@/db/schema";
import { tagKey } from "@/lib/tagNames";
import { splitSearchTerms } from "@/lib/recipeSearch";

/**
 * The recipe list's search, filters, sort and paging — done in the database.
 *
 * With a jar of a thousand recipes, sending all of them to the browser to be
 * filtered there made the page slow to load and slow to draw. This asks for
 * one page and the counts around it instead.
 *
 * One function serves the page, GET /api/recipes/search and the bulk "select
 * all matching" action, so what a person sees and what a bulk action reaches
 * are the same query, not two copies of it that can drift.
 *
 * Visibility is the first condition and not optional: the House Jar tab is
 * the household's shared recipes, the Secret Stash tab is the viewer's own.
 * Nothing here can return someone else's private recipe.
 *
 * Search uses LIKE rather than a full-text index. At a few thousand recipes a
 * scan is a few milliseconds, and LIKE matches parts of words ("chick" finds
 * "chickpea") the way the old in-browser search did. Revisit with FTS5 if a
 * household ever gets to tens of thousands.
 */

export * from "@/lib/recipeQueryParams";
import {
  FILTER_MEAL_TYPES,
  MAX_MATCHING,
  type RecipeFacets,
  type RecipePage,
  type RecipeQuery,
  type RecipeTab,
} from "@/lib/recipeQueryParams";

/** LIKE pattern for a literal substring, with LIKE's own wildcards escaped. */
function likePattern(text: string): string {
  return `%${text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Meal types stored comma-separated; match whole entries, not substrings. */
function hasMealType(value: string): SQL {
  return sql`(',' || replace(${recipes.mealType}, ' ', '') || ',') LIKE ${`%,${value},%`}`;
}

function tabCondition(householdId: string, userId: string, tab: RecipeTab): SQL {
  return tab === "shared"
    ? and(eq(recipes.householdId, householdId), eq(recipes.visibility, "shared"))!
    : and(
        eq(recipes.householdId, householdId),
        eq(recipes.visibility, "private"),
        eq(recipes.ownerUserId, userId)
      )!;
}

/**
 * The search box. Several terms separated by commas or semicolons must ALL
 * match — "chicken thighs, orzo" finds recipes with both — each in any of the
 * ticked fields. Within a term, words are matched together as typed.
 */
function searchCondition(q: RecipeQuery): SQL | undefined {
  const terms = splitSearchTerms(q.q);
  if (terms.length === 0) return undefined;
  const { name, tags: inTags, ingredients } = q.fields;
  if (!name && !inTags && !ingredients) return undefined;
  return and(...terms.map((term) => termCondition(term, q.fields)));
}

function termCondition(term: string, fields: RecipeQuery["fields"]): SQL {
  const pat = likePattern(term);
  const parts: SQL[] = [];
  if (fields.name) parts.push(sql`lower(${recipes.name}) LIKE ${pat} ESCAPE '\\'`);
  if (fields.ingredients) parts.push(sql`lower(${recipes.ingredients}) LIKE ${pat} ESCAPE '\\'`);
  if (fields.tags) {
    parts.push(
      sql`EXISTS (SELECT 1 FROM ${recipeTags} JOIN ${tags} ON ${tags.id} = ${recipeTags.tagId}
          WHERE ${recipeTags.recipeId} = ${recipes.id} AND ${tags.nameKey} LIKE ${pat} ESCAPE '\\')`
    );
    // Meal types count as tags, matched on what the badge says — see
    // matchesRecipeSearch. "any" also answers to "any meal".
    parts.push(sql`lower(replace(${recipes.mealType}, 'any', 'any meal')) LIKE ${pat} ESCAPE '\\'`);
  }
  return or(...parts)!;
}

function tagCondition(names: string[], match: "all" | "any"): SQL | undefined {
  const keys = [...new Set(names.map(tagKey))];
  if (keys.length === 0) return undefined;
  const carries = (k: string[]) =>
    sql`EXISTS (SELECT 1 FROM ${recipeTags} JOIN ${tags} ON ${tags.id} = ${recipeTags.tagId}
        WHERE ${recipeTags.recipeId} = ${recipes.id} AND ${inArray(tags.nameKey, k)})`;
  return match === "any" || keys.length === 1 ? carries(keys) : and(...keys.map((k) => carries([k])));
}

/** Every condition except paging. `skip` leaves one facet's own filter out. */
function conditions(
  householdId: string,
  userId: string,
  q: RecipeQuery,
  skip?: "mealTypes"
): SQL {
  const parts: (SQL | undefined)[] = [
    tabCondition(householdId, userId, q.tab),
    searchCondition(q),
    tagCondition(q.tags, q.tagMatch),
  ];
  if (skip !== "mealTypes" && q.mealTypes.length > 0) parts.push(or(...q.mealTypes.map(hasMealType)));
  if (q.favoritesOnly) {
    parts.push(
      sql`EXISTS (SELECT 1 FROM ${recipeFavorites} WHERE ${recipeFavorites.recipeId} = ${recipes.id}
          AND ${recipeFavorites.userId} = ${userId})`
    );
  }
  if (q.maxMinutes) {
    parts.push(
      sql`(${recipes.prepTimeMinutes} IS NOT NULL OR ${recipes.cookTimeMinutes} IS NOT NULL)
          AND coalesce(${recipes.prepTimeMinutes}, 0) + coalesce(${recipes.cookTimeMinutes}, 0) <= ${q.maxMinutes}`
    );
  }
  return and(...parts.filter((p): p is SQL => Boolean(p)))!;
}

/**
 * Plan history the viewer is allowed to know about: the household calendar,
 * and their own private plan. Someone else's private plan is not evidence
 * this person may see, even as "last planned".
 */
function planStats(householdId: string, userId: string) {
  return db
    .select({
      recipeId: planEntries.recipeId,
      last: sql<string>`max(${planEntries.date})`.as("last"),
      times: sql<number>`count(*)`.as("times"),
    })
    .from(planEntries)
    .where(
      and(
        eq(planEntries.householdId, householdId),
        or(
          eq(planEntries.scope, "shared"),
          and(eq(planEntries.scope, "private"), eq(planEntries.userId, userId))
        )
      )
    )
    .groupBy(planEntries.recipeId)
    .as("plan_stats");
}

export function queryRecipes(householdId: string, userId: string, q: RecipeQuery): RecipePage {
  const where = conditions(householdId, userId, q);
  const stats = planStats(householdId, userId);

  const total =
    db.select({ n: sql<number>`count(*)` }).from(recipes).where(where).get()?.n ?? 0;
  const tabTotal =
    db
      .select({ n: sql<number>`count(*)` })
      .from(recipes)
      .where(tabCondition(householdId, userId, q.tab))
      .get()?.n ?? 0;

  // Past the end (a delete emptied the last page, or a stale link): show the
  // last page there is rather than an empty one.
  const lastPage = Math.max(1, Math.ceil(total / q.limit));
  const page = Math.min(q.page, lastPage);

  const nameOrder = sql`${recipes.name} COLLATE NOCASE`;
  const order: SQL[] =
    q.sort === "newest"
      ? [desc(recipes.createdAt), asc(nameOrder)]
      : q.sort === "planned_recent"
        ? [sql`${stats.last} IS NULL`, desc(stats.last), asc(nameOrder)]
        : q.sort === "planned_least"
          ? // Never planned first, then longest ago.
            [sql`${stats.last} IS NOT NULL`, asc(stats.last), asc(nameOrder)]
          : q.sort === "planned_most"
            ? [desc(sql`coalesce(${stats.times}, 0)`), asc(nameOrder)]
            : [asc(nameOrder), asc(recipes.id)];

  const base = db
    .select({
      id: recipes.id,
      name: recipes.name,
      visibility: recipes.visibility,
      ownerUserId: recipes.ownerUserId,
      mealType: recipes.mealType,
      prepTimeMinutes: recipes.prepTimeMinutes,
      cookTimeMinutes: recipes.cookTimeMinutes,
      servings: recipes.servings,
      snippet: sql<string>`substr(${recipes.instructions}, 1, 240)`,
      lastPlanned: stats.last,
      timesPlanned: sql<number>`coalesce(${stats.times}, 0)`,
    })
    .from(recipes)
    .leftJoin(stats, eq(stats.recipeId, recipes.id))
    .where(where)
    .orderBy(...order)
    .limit(q.limit)
    .offset((page - 1) * q.limit)
    .all();

  const ids = base.map((r) => r.id);
  const tagRows = ids.length
    ? db
        .select({ recipeId: recipeTags.recipeId, name: tags.name })
        .from(recipeTags)
        .innerJoin(tags, eq(tags.id, recipeTags.tagId))
        .where(inArray(recipeTags.recipeId, ids))
        .orderBy(asc(sql`${tags.name} COLLATE NOCASE`))
        .all()
    : [];
  const tagsBy = new Map<string, string[]>();
  for (const t of tagRows) tagsBy.set(t.recipeId, [...(tagsBy.get(t.recipeId) ?? []), t.name]);

  const favRows = ids.length
    ? db
        .select({ recipeId: recipeFavorites.recipeId })
        .from(recipeFavorites)
        .where(and(eq(recipeFavorites.userId, userId), inArray(recipeFavorites.recipeId, ids)))
        .all()
    : [];
  const favs = new Set(favRows.map((f) => f.recipeId));

  return {
    rows: base.map((r) => ({
      ...r,
      tags: tagsBy.get(r.id) ?? [],
      isFavorite: favs.has(r.id),
      lastPlanned: r.lastPlanned ?? null,
    })),
    total,
    tabTotal,
    page,
    limit: q.limit,
    facets: facets(householdId, userId, q, where),
  };
}

/**
 * Counts for the filter sidebar.
 *
 * Tag and favourite counts are over the current results, so "Vegetarian (12)"
 * means ticking it leaves twelve. Meal type counts leave the meal type filter
 * itself out — otherwise ticking Dinner would make Lunch read 0, and nobody
 * could tick a second one.
 */
function facets(householdId: string, userId: string, q: RecipeQuery, where: SQL): RecipeFacets {
  const tagCounts = db
    .select({ name: sql<string>`min(${tags.name})`, count: sql<number>`count(*)` })
    .from(recipeTags)
    .innerJoin(tags, eq(tags.id, recipeTags.tagId))
    .innerJoin(recipes, eq(recipes.id, recipeTags.recipeId))
    .where(where)
    .groupBy(tags.nameKey)
    .orderBy(desc(sql`count(*)`), asc(sql`min(${tags.name}) COLLATE NOCASE`))
    .all();

  // Selected tags stay listed even at zero, so they can always be unticked.
  for (const name of q.tags) {
    if (!tagCounts.some((t) => tagKey(t.name) === tagKey(name))) tagCounts.push({ name, count: 0 });
  }

  const mealWhere = conditions(householdId, userId, q, "mealTypes");
  const mealTypes = FILTER_MEAL_TYPES.map((value) => ({
    value,
    count:
      db
        .select({ n: sql<number>`count(*)` })
        .from(recipes)
        .where(and(mealWhere, hasMealType(value)))
        .get()?.n ?? 0,
  }));

  const favorites =
    db
      .select({ n: sql<number>`count(*)` })
      .from(recipes)
      .innerJoin(
        recipeFavorites,
        and(eq(recipeFavorites.recipeId, recipes.id), eq(recipeFavorites.userId, userId))
      )
      .where(where)
      .get()?.n ?? 0;

  return { mealTypes, tags: tagCounts, favorites };
}

/**
 * Every recipe id matching a query, ignoring paging, capped at MAX_MATCHING.
 * For "select all matching": the bulk action resolves the filter here, with
 * the same conditions the list used, so it reaches exactly what the list
 * would show page by page.
 */
export function matchingRecipeIds(householdId: string, userId: string, q: RecipeQuery): string[] {
  return db
    .select({ id: recipes.id })
    .from(recipes)
    .where(conditions(householdId, userId, q))
    .limit(MAX_MATCHING)
    .all()
    .map((r) => r.id);
}
