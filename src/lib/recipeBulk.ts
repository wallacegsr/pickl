import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  planEntries,
  recipes,
  recipeTags,
  tags,
  RECIPE_MEAL_TYPES,
  parseRecipeMealTypes,
  type Recipe,
  type RecipeMealType,
} from "@/db/schema";
import {
  canEditRecipe,
  canEditSharedRecipes,
  type SessionUser,
} from "@/lib/permissions";
import { createRecipe } from "@/lib/recipes";
import { ensureTag, findTagByName } from "@/lib/tags";
import { MAX_TAG_LENGTH, normalizeTagName, tagKey } from "@/lib/tagNames";

/**
 * Bulk operations on recipes: delete, and copy between the House Jar and a
 * Secret Stash.
 *
 * ---------------------------------------------------------------------------
 * Preview and action are the same function
 * ---------------------------------------------------------------------------
 * Every operation takes `dryRun`. The confirmation dialog calls it with
 * `dryRun: true` to learn what WILL happen — which rows are refused and why,
 * how many planned meals a delete takes with it — and then calls it again for
 * real. So the numbers a person agrees to are computed by exactly the code
 * that then acts, and the browser never re-implements the permission rules to
 * guess at them. A client-side guess would be a second copy of those rules.
 *
 * Nothing here trusts an id. Every recipe is looked up by id AND household,
 * so an id from another household simply does not resolve.
 */

export type BulkStatus = "ok" | "skipped" | "failed";

export interface BulkRowResult {
  id: string;
  name: string | null;
  status: BulkStatus;
  reason?: string;
  /** Delete only: planned meals, past and future, that go with this recipe. */
  plannedMeals?: number;
  /** Tag only: how many of the named tags this recipe gains or loses. */
  changes?: number;
}

export interface BulkSummary {
  dryRun: boolean;
  ok: number;
  skipped: number;
  failed: number;
  /** Delete only: total planned meals the confirmed delete removes. */
  plannedMeals?: number;
  /**
   * Tag "add" only: names that are not yet tags in this household and will be
   * created. Reported so a typo shows up in the confirmation as a new tag
   * rather than quietly becoming one.
   */
  newTags?: string[];
  /** Tag only: total tag links added or removed across the batch. */
  changes?: number;
  rows: BulkRowResult[];
}

function summarise(dryRun: boolean, rows: BulkRowResult[]): BulkSummary {
  return {
    dryRun,
    ok: rows.filter((r) => r.status === "ok").length,
    skipped: rows.filter((r) => r.status === "skipped").length,
    failed: rows.filter((r) => r.status === "failed").length,
    rows,
  };
}

/** The requested recipes that exist in this household, keyed by id. */
function loadRecipes(householdId: string, ids: string[]): Map<string, Recipe> {
  if (ids.length === 0) return new Map();
  const rows = db
    .select()
    .from(recipes)
    .where(and(eq(recipes.householdId, householdId), inArray(recipes.id, ids)))
    .all();
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Whether this user can see a recipe at all: the shared pool, or their own
 * private recipes. Another member's private recipe is not theirs to copy —
 * and is not on their screen to have selected in the first place.
 */
function canSee(user: SessionUser, recipe: Recipe): boolean {
  return recipe.visibility === "shared" || recipe.ownerUserId === user.id;
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Deletes the recipes this user may edit and reports on every one asked for.
 *
 * Deleting a recipe cascades: its rows in the plan go with it — past meals as
 * well as future ones, so they also vanish from Past Preserves — along with
 * any ingredients ticked off on the shopping list. That is why the preview
 * counts planned meals per recipe. A dialog that says "delete 5 recipes"
 * without saying "and 23 meals out of your history" is asking a person to
 * agree to something they have not been told.
 */
export function bulkDelete(
  user: SessionUser,
  householdId: string,
  ids: string[],
  dryRun: boolean
): BulkSummary {
  const unique = [...new Set(ids)];
  const found = loadRecipes(householdId, unique);

  // One grouped query for every requested recipe rather than one per row.
  const plannedCounts = new Map<string, number>();
  if (found.size > 0) {
    for (const row of db
      .select({ recipeId: planEntries.recipeId, count: sql<number>`count(*)` })
      .from(planEntries)
      .where(
        and(
          eq(planEntries.householdId, householdId),
          inArray(planEntries.recipeId, [...found.keys()])
        )
      )
      .groupBy(planEntries.recipeId)
      .all()) {
      if (row.recipeId) plannedCounts.set(row.recipeId, Number(row.count));
    }
  }

  const rows: BulkRowResult[] = [];
  const deletable: string[] = [];

  for (const id of unique) {
    const recipe = found.get(id);
    if (!recipe || !canSee(user, recipe)) {
      // Same answer for "does not exist" and "not yours to see": which of the
      // two it is would itself be information about someone's private recipes.
      rows.push({ id, name: null, status: "failed", reason: "Recipe not found." });
      continue;
    }
    if (!canEditRecipe(user, recipe)) {
      rows.push({
        id,
        name: recipe.name,
        status: "skipped",
        reason:
          recipe.visibility === "shared"
            ? "Only admins can delete recipes from the House Jar."
            : "Only its owner can delete this recipe.",
      });
      continue;
    }
    rows.push({
      id,
      name: recipe.name,
      status: "ok",
      plannedMeals: plannedCounts.get(id) ?? 0,
    });
    deletable.push(id);
  }

  if (!dryRun && deletable.length > 0) {
    // Household in the WHERE as well as in the lookup above: the ids have been
    // checked, but a delete is the one statement where belt-and-braces costs
    // nothing and a mistake costs everything.
    db.delete(recipes)
      .where(and(eq(recipes.householdId, householdId), inArray(recipes.id, deletable)))
      .run();
  }

  const summary = summarise(dryRun, rows);
  summary.plannedMeals = rows.reduce((n, r) => n + (r.plannedMeals ?? 0), 0);
  return summary;
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

export type CopyTarget = "private" | "shared";

/**
 * Copies recipes into a Secret Stash or into the House Jar.
 *
 * Always a copy, never a move: the original stays exactly where it was, so a
 * copy can be edited freely without changing the recipe the rest of the
 * household plans from.
 *
 * The rules, which are the recipe-creation rules and nothing new:
 *
 *   - INTO YOUR STASH: anyone may copy anything they can see. Taking a copy of
 *     a House Jar recipe to tweak for yourself needs no permission, because it
 *     changes nothing anyone else sees.
 *   - INTO THE HOUSE JAR: only someone who could create a shared recipe by
 *     hand — an admin. Otherwise a copy would be a way around that rule.
 *
 * Tags come along, through `createRecipe` and so through `ensureTag`, which
 * matches them against the household's existing tags rather than making new
 * ones with the same name.
 */
export function bulkCopy(
  user: SessionUser,
  householdId: string,
  ids: string[],
  target: CopyTarget,
  dryRun: boolean
): BulkSummary {
  const unique = [...new Set(ids)];
  const rows: BulkRowResult[] = [];

  if (target === "shared" && !canEditSharedRecipes(user)) {
    // Decided before touching a single recipe: nothing this user selected
    // could go into the jar, so there is no point loading any of them. Each
    // still gets a row, so the response has the same shape as every other.
    for (const id of unique) {
      rows.push({
        id,
        name: null,
        status: "failed",
        reason: "Only admins can add recipes to the House Jar.",
      });
    }
    return summarise(dryRun, rows);
  }

  const found = loadRecipes(householdId, unique);

  // Destination's existing recipes, for duplicate detection — the user's own
  // stash for a private copy, the shared pool for a shared one.
  const destination = db
    .select({ name: recipes.name, sourceUrl: recipes.sourceUrl })
    .from(recipes)
    .where(
      and(
        eq(recipes.householdId, householdId),
        target === "private"
          ? and(eq(recipes.visibility, "private"), eq(recipes.ownerUserId, user.id))
          : eq(recipes.visibility, "shared")
      )
    )
    .all();
  const already = new Set(destination.map((r) => copyKey(r.name, r.sourceUrl)));

  const tagsByRecipe = loadTagNames(householdId, [...found.keys()]);

  for (const id of unique) {
    const recipe = found.get(id);
    if (!recipe || !canSee(user, recipe)) {
      rows.push({ id, name: null, status: "failed", reason: "Recipe not found." });
      continue;
    }

    const alreadyThere =
      target === "private"
        ? recipe.visibility === "private" && recipe.ownerUserId === user.id
        : recipe.visibility === "shared";
    if (alreadyThere) {
      rows.push({
        id,
        name: recipe.name,
        status: "skipped",
        reason:
          target === "private"
            ? "Already in your Secret Stash."
            : "Already in the House Jar.",
      });
      continue;
    }

    const key = copyKey(recipe.name, recipe.sourceUrl);
    if (already.has(key)) {
      rows.push({
        id,
        name: recipe.name,
        status: "skipped",
        reason:
          target === "private"
            ? "Your Secret Stash already has a copy."
            : "The House Jar already has a copy.",
      });
      continue;
    }
    // A selection holding two identical recipes copies one of them.
    already.add(key);

    if (!dryRun) {
      createRecipe({
        householdId,
        actingUserId: user.id,
        data: {
          name: recipe.name,
          ingredients: recipe.ingredients,
          instructions: recipe.instructions,
          prepTimeMinutes: recipe.prepTimeMinutes,
          cookTimeMinutes: recipe.cookTimeMinutes,
          servings: recipe.servings,
          sourceUrl: recipe.sourceUrl ?? "",
          notes: recipe.notes ?? "",
          visibility: target,
          mealType: storedMealTypes(recipe.mealType),
          tags: (tagsByRecipe.get(id) ?? []).join(","),
        },
      });
    }
    rows.push({ id, name: recipe.name, status: "ok" });
  }

  return summarise(dryRun, rows);
}

/**
 * A stored meal-type string as the typed list createRecipe takes.
 *
 * Filtered against the known values rather than cast, so a row written by
 * something older or hand-edited cannot push an unknown meal type into a copy.
 * Falls back to "any", the schema's own default, if nothing valid survives.
 */
function storedMealTypes(stored: string): RecipeMealType[] {
  const known = new Set<string>(RECIPE_MEAL_TYPES);
  const valid = parseRecipeMealTypes(stored).filter((t): t is RecipeMealType => known.has(t));
  return valid.length > 0 ? valid : ["any"];
}

/**
 * What counts as "the same recipe" for a copy.
 *
 * Name and source URL together. Name alone would refuse a second "Chicken
 * Soup" the household is entitled to; URL alone would refuse every copy of a
 * recipe that has one, because the original already carries it. Together they
 * catch the realistic mistake — copying the same thing twice — without a
 * provenance column that would need a migration.
 */
function copyKey(name: string, sourceUrl: string | null): string {
  return `${name.trim().toLowerCase()} ${(sourceUrl ?? "").trim().toLowerCase()}`;
}

function loadTagNames(householdId: string, recipeIds: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (recipeIds.length === 0) return map;
  for (const row of db
    .select({ recipeId: recipeTags.recipeId, name: tags.name })
    .from(recipeTags)
    .innerJoin(tags, eq(tags.id, recipeTags.tagId))
    .where(and(eq(tags.householdId, householdId), inArray(recipeTags.recipeId, recipeIds)))
    .all()) {
    const list = map.get(row.recipeId) ?? [];
    list.push(row.name);
    map.set(row.recipeId, list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Tag
// ---------------------------------------------------------------------------

export type TagMode = "add" | "remove";

/**
 * Adds tags to, or removes tags from, many recipes at once.
 *
 * Add and remove only — never "replace with". Replacing across thirty recipes
 * would silently wipe whatever tags each one already had, which is not a
 * thing a bulk action should be able to do to someone by accident. Add and
 * remove each change only the tags named, and each undoes the other.
 *
 * The permission rule is the Tags page's: a tag change reaches only recipes
 * this person may edit. A member who selects House Jar recipes has those
 * refused row by row, shown in the preview, and nothing else is touched.
 *
 * Removing a tag from the last recipe that carried it does NOT delete the tag.
 * An unused tag is legitimate household vocabulary (see setRecipeTags), and
 * sweeping it away would make this action quietly edit the Tags page too.
 */
export function bulkTag(
  user: SessionUser,
  householdId: string,
  ids: string[],
  rawTags: string[],
  mode: TagMode,
  dryRun: boolean
): BulkSummary {
  // Normalised and de-duplicated by key, so "Quick" and "quick " are one tag.
  const byKey = new Map<string, string>();
  for (const raw of rawTags) {
    const display = normalizeTagName(raw).slice(0, MAX_TAG_LENGTH);
    const key = tagKey(display);
    if (key && !byKey.has(key)) byKey.set(key, display);
  }
  const names = [...byKey.values()];

  const unique = [...new Set(ids)];
  const found = loadRecipes(householdId, unique);
  const current = loadTagNames(householdId, [...found.keys()]);

  // Resolved once: which named tags already exist in this household.
  const existing = new Map<string, string>(); // key -> tag id
  for (const name of names) {
    const tag = findTagByName(householdId, name);
    if (tag) existing.set(tagKey(name), tag.id);
  }

  const rows: BulkRowResult[] = [];
  const plan: { recipeId: string; names: string[] }[] = [];

  for (const id of unique) {
    const recipe = found.get(id);
    if (!recipe || !canSee(user, recipe)) {
      rows.push({ id, name: null, status: "failed", reason: "Recipe not found." });
      continue;
    }
    if (!canEditRecipe(user, recipe)) {
      rows.push({
        id,
        name: recipe.name,
        status: "skipped",
        reason:
          recipe.visibility === "shared"
            ? "Only admins can change tags on House Jar recipes."
            : "Only its owner can change this recipe's tags.",
      });
      continue;
    }

    const has = new Set((current.get(id) ?? []).map(tagKey));
    const relevant =
      mode === "add"
        ? names.filter((n) => !has.has(tagKey(n)))
        : names.filter((n) => has.has(tagKey(n)));

    if (relevant.length === 0) {
      rows.push({
        id,
        name: recipe.name,
        status: "skipped",
        reason: mode === "add" ? "Already has these tags." : "Has none of these tags.",
      });
      continue;
    }

    rows.push({ id, name: recipe.name, status: "ok", changes: relevant.length });
    plan.push({ recipeId: id, names: relevant });
  }

  if (!dryRun && plan.length > 0) {
    if (mode === "add") {
      // ensureTag matches the household's existing tags case-insensitively and
      // creates only what is genuinely new — never a second "Weeknight".
      const tagIds = new Map<string, string>();
      for (const name of names) {
        if (plan.some((p) => p.names.includes(name))) {
          tagIds.set(tagKey(name), ensureTag(householdId, name, user.id).id);
        }
      }
      for (const { recipeId, names: toAdd } of plan) {
        for (const name of toAdd) {
          const tagId = tagIds.get(tagKey(name));
          if (!tagId) continue;
          db.insert(recipeTags).values({ recipeId, tagId }).onConflictDoNothing().run();
        }
      }
    } else {
      for (const { recipeId, names: toRemove } of plan) {
        for (const name of toRemove) {
          const tagId = existing.get(tagKey(name));
          if (!tagId) continue;
          db.delete(recipeTags)
            .where(and(eq(recipeTags.recipeId, recipeId), eq(recipeTags.tagId, tagId)))
            .run();
        }
      }
    }
  }

  const summary = summarise(dryRun, rows);
  summary.changes = rows.reduce((n, r) => n + (r.changes ?? 0), 0);
  if (mode === "add") {
    // Only names that will actually land on a recipe. Worked out from the plan
    // rather than from the request, or a batch whose every recipe was refused
    // would still promise to create a tag it never creates.
    summary.newTags = names.filter(
      (n) => !existing.has(tagKey(n)) && plan.some((p) => p.names.includes(n))
    );
  }
  return summary;
}
