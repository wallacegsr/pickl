import { randomUUID } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  recipeTags,
  recipes,
  tags,
  type Recipe,
  type RecipeWithTags,
  type Tag,
} from "@/db/schema";
import { isAdmin, type SessionUser } from "@/lib/permissions";
import { MAX_TAG_LENGTH, normalizeTagName, tagKey } from "@/lib/tagNames";

export {
  normalizeTagName,
  tagKey,
  parseTagInput,
  formatTagInput,
  MAX_TAG_LENGTH,
} from "@/lib/tagNames";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Tag names for a whole set of recipes in ONE query.
 *
 * This is the single helper every list view goes through — the /recipes
 * list, the plan page's recipe pool, the export. Nothing anywhere fetches
 * tags per recipe in a loop.
 */
export function getTagsForRecipes(
  recipeIds: string[]
): Map<string, string[]> {
  const byRecipe = new Map<string, string[]>();
  for (const id of recipeIds) byRecipe.set(id, []);
  if (recipeIds.length === 0) return byRecipe;

  const rows = db
    .select({
      recipeId: recipeTags.recipeId,
      name: tags.name,
      nameKey: tags.nameKey,
    })
    .from(recipeTags)
    .innerJoin(tags, eq(tags.id, recipeTags.tagId))
    .where(inArray(recipeTags.recipeId, recipeIds))
    .orderBy(tags.nameKey)
    .all();

  for (const row of rows) {
    const list = byRecipe.get(row.recipeId);
    if (list) list.push(row.name);
  }
  return byRecipe;
}

/** Attaches `tags: string[]` to a list of recipe rows (one extra query). */
export function attachTags<T extends Recipe>(rows: T[]): (T & { tags: string[] })[] {
  const byRecipe = getTagsForRecipes(rows.map((r) => r.id));
  return rows.map((row) => ({ ...row, tags: byRecipe.get(row.id) ?? [] }));
}

/** Attaches tags to a single recipe row. */
export function attachTagsToRecipe(row: Recipe): RecipeWithTags {
  return attachTags([row])[0];
}

// ---------------------------------------------------------------------------
// Writes from the recipe form
// ---------------------------------------------------------------------------

/** Finds (or creates) the tag row for `name`, matching case-insensitively. */
export function ensureTag(name: string, userId: string | null): Tag {
  const display = normalizeTagName(name).slice(0, MAX_TAG_LENGTH);
  const key = tagKey(display);
  const existing = db.select().from(tags).where(eq(tags.nameKey, key)).get();
  if (existing) return existing;

  const id = randomUUID();
  db.insert(tags)
    .values({
      id,
      name: display,
      nameKey: key,
      createdByUserId: userId,
    })
    .onConflictDoNothing()
    .run();

  // onConflictDoNothing covers the race where another request created the
  // same tag between the SELECT and the INSERT; re-read rather than assume.
  return db.select().from(tags).where(eq(tags.nameKey, key)).get()!;
}

/**
 * Replaces a recipe's tags with exactly `names`, creating any that are new.
 *
 * Tags that end up on no recipe at all are deliberately NOT swept up: an
 * empty tag is a legitimate row here (you can create one from the Tags page
 * before you have anything to put it on), so "unused" is not the same as
 * "garbage".
 */
export function setRecipeTags(
  recipeId: string,
  names: string[],
  userId: string | null
) {
  const wanted = new Map<string, Tag>();
  for (const name of names) {
    const tag = ensureTag(name, userId);
    wanted.set(tag.id, tag);
  }

  db.delete(recipeTags).where(eq(recipeTags.recipeId, recipeId)).run();
  for (const tagId of wanted.keys()) {
    db.insert(recipeTags)
      .values({ recipeId, tagId })
      .onConflictDoNothing()
      .run();
  }
}

// ---------------------------------------------------------------------------
// The Tags page: visibility, permissions, and the edit operations
// ---------------------------------------------------------------------------

/**
 * How a tag's recipes divide up for one user.
 *
 * `editable` is the recipes this user may already edit — their own private
 * ones, plus shared ones if they are an admin. `locked` is everything else
 * the tag touches, counted but never described: for a member that is the
 * shared pool and any other member's private recipes; for an admin it is
 * other people's private recipes, which no admin override reaches.
 *
 * Every tag mutation applies to `editable` and to nothing else. That is the
 * whole permission model, and it is enforced here rather than in the UI.
 */
export interface TagUsage {
  editable: number;
  locked: number;
  total: number;
}

export interface TagSummary {
  id: string;
  name: string;
  usage: TagUsage;
}

function editableRecipeCondition(user: SessionUser) {
  return isAdmin(user)
    ? or(eq(recipes.visibility, "shared"), eq(recipes.ownerUserId, user.id))
    : and(eq(recipes.visibility, "private"), eq(recipes.ownerUserId, user.id));
}

/** Recipe ids carrying `tagId` that `user` is allowed to edit. */
export function editableRecipeIdsForTag(
  user: SessionUser,
  tagId: string
): string[] {
  return db
    .select({ id: recipes.id })
    .from(recipeTags)
    .innerJoin(recipes, eq(recipes.id, recipeTags.recipeId))
    .where(and(eq(recipeTags.tagId, tagId), editableRecipeCondition(user)))
    .all()
    .map((r) => r.id);
}

export function getTagUsage(user: SessionUser, tagId: string): TagUsage {
  const total = db
    .select({ id: recipeTags.recipeId })
    .from(recipeTags)
    .where(eq(recipeTags.tagId, tagId))
    .all().length;
  const editable = editableRecipeIdsForTag(user, tagId).length;
  return { editable, locked: total - editable, total };
}

/**
 * Every tag this user can see, with usage counts.
 *
 * "Can see" means: used by at least one recipe they can read (the shared
 * pool plus their own private recipes), or used by nothing at all — a
 * standalone tag is household vocabulary and belongs to everyone. A tag
 * that exists only on somebody else's private recipes is not listed, for
 * the same reason the recipe itself is not.
 */
export function listVisibleTags(user: SessionUser): TagSummary[] {
  const all = db.select().from(tags).orderBy(tags.nameKey).all();

  const visibleCounts = new Map<string, number>();
  const editableCounts = new Map<string, number>();
  const totalCounts = new Map<string, number>();

  for (const row of db
    .select({ tagId: recipeTags.tagId, count: sql<number>`count(*)` })
    .from(recipeTags)
    .groupBy(recipeTags.tagId)
    .all()) {
    totalCounts.set(row.tagId, Number(row.count));
  }

  for (const row of db
    .select({ tagId: recipeTags.tagId, count: sql<number>`count(*)` })
    .from(recipeTags)
    .innerJoin(recipes, eq(recipes.id, recipeTags.recipeId))
    .where(
      or(eq(recipes.visibility, "shared"), eq(recipes.ownerUserId, user.id))
    )
    .groupBy(recipeTags.tagId)
    .all()) {
    visibleCounts.set(row.tagId, Number(row.count));
  }

  for (const row of db
    .select({ tagId: recipeTags.tagId, count: sql<number>`count(*)` })
    .from(recipeTags)
    .innerJoin(recipes, eq(recipes.id, recipeTags.recipeId))
    .where(editableRecipeCondition(user))
    .groupBy(recipeTags.tagId)
    .all()) {
    editableCounts.set(row.tagId, Number(row.count));
  }

  return all
    .filter(
      (tag) =>
        (totalCounts.get(tag.id) ?? 0) === 0 ||
        (visibleCounts.get(tag.id) ?? 0) > 0
    )
    .map((tag) => {
      const total = totalCounts.get(tag.id) ?? 0;
      const editable = editableCounts.get(tag.id) ?? 0;
      return {
        id: tag.id,
        name: tag.name,
        usage: { editable, locked: total - editable, total },
      };
    });
}

/** Whether `user` may see this tag at all (same rule as listVisibleTags). */
export function canSeeTag(user: SessionUser, tagId: string): boolean {
  const total = db
    .select({ id: recipeTags.recipeId })
    .from(recipeTags)
    .where(eq(recipeTags.tagId, tagId))
    .all().length;
  if (total === 0) return true;
  const visible = db
    .select({ id: recipes.id })
    .from(recipeTags)
    .innerJoin(recipes, eq(recipes.id, recipeTags.recipeId))
    .where(
      and(
        eq(recipeTags.tagId, tagId),
        or(eq(recipes.visibility, "shared"), eq(recipes.ownerUserId, user.id))
      )
    )
    .all().length;
  return visible > 0;
}

export function findTagByName(name: string): Tag | undefined {
  return db.select().from(tags).where(eq(tags.nameKey, tagKey(name))).get();
}

export function getTagById(id: string): Tag | undefined {
  return db.select().from(tags).where(eq(tags.id, id)).get();
}

export type TagMutationResult =
  | { ok: true; movedRecipes: number; lockedRecipes: number; merged: boolean; tagName: string }
  | { ok: false; status: number; error: string; needsMergeConfirm?: boolean };

/**
 * Renames a tag, merging into an existing one if the new name collides.
 *
 * A collision MERGES rather than being rejected — but never silently: the
 * route requires `confirmMerge`, and without it this returns
 * `needsMergeConfirm` so the caller can say what is about to happen first.
 *
 * When some of the tag's recipes are out of this user's reach, the rename
 * applies to their recipes only and the original tag stays put on the rest.
 * That is not a partial failure, it is the permission rule: a member's tag
 * edit must never modify a shared recipe.
 */
export function renameTag(
  user: SessionUser,
  tagId: string,
  newName: string,
  opts: { confirmMerge?: boolean } = {}
): TagMutationResult {
  const tag = getTagById(tagId);
  if (!tag || !canSeeTag(user, tagId)) {
    return { ok: false, status: 404, error: "Tag not found." };
  }

  const display = normalizeTagName(newName).slice(0, MAX_TAG_LENGTH);
  if (!display) return { ok: false, status: 400, error: "Enter a tag name." };
  const newKey = tagKey(display);

  const editableIds = editableRecipeIdsForTag(user, tagId);
  const usage = getTagUsage(user, tagId);

  if (usage.total > 0 && editableIds.length === 0) {
    return {
      ok: false,
      status: 403,
      error:
        "You can't rename this tag — every recipe using it is one you're not allowed to edit.",
    };
  }

  // Case-only edit ("quick" -> "Quick"): there is no second tag to split
  // into, so the display name is shared by every recipe using it. Only
  // allow it when the user can edit all of them.
  if (newKey === tag.nameKey) {
    if (usage.locked > 0) {
      return {
        ok: false,
        status: 403,
        error:
          "Changing only the capitalisation would change how this tag reads on recipes you can't edit.",
      };
    }
    db.update(tags)
      .set({ name: display, updatedAt: new Date() })
      .where(eq(tags.id, tagId))
      .run();
    return {
      ok: true,
      movedRecipes: usage.editable,
      lockedRecipes: 0,
      merged: false,
      tagName: display,
    };
  }

  const target = db.select().from(tags).where(eq(tags.nameKey, newKey)).get();
  if (target && !opts.confirmMerge) {
    return {
      ok: false,
      status: 409,
      error: `A tag called "${target.name}" already exists. Renaming will merge the two.`,
      needsMergeConfirm: true,
    };
  }

  // Nothing is locked and no name to merge into: a plain in-place rename,
  // which keeps the tag's id (and therefore every association) intact.
  if (!target && usage.locked === 0) {
    db.update(tags)
      .set({ name: display, nameKey: newKey, updatedAt: new Date() })
      .where(eq(tags.id, tagId))
      .run();
    return {
      ok: true,
      movedRecipes: usage.editable,
      lockedRecipes: 0,
      merged: false,
      tagName: display,
    };
  }

  const destination = target ?? ensureTag(display, user.id);

  for (const recipeId of editableIds) {
    db.delete(recipeTags)
      .where(and(eq(recipeTags.recipeId, recipeId), eq(recipeTags.tagId, tagId)))
      .run();
    db.insert(recipeTags)
      .values({ recipeId, tagId: destination.id })
      .onConflictDoNothing()
      .run();
  }

  // The old tag only disappears if nothing is left on it. When a member's
  // rename left it on shared recipes, it stays — exactly as those recipes
  // still show it.
  const remaining = db
    .select({ id: recipeTags.recipeId })
    .from(recipeTags)
    .where(eq(recipeTags.tagId, tagId))
    .all().length;
  if (remaining === 0 && tag.id !== destination.id) {
    db.delete(tags).where(eq(tags.id, tag.id)).run();
  }

  db.update(tags)
    .set({ updatedAt: new Date() })
    .where(eq(tags.id, destination.id))
    .run();

  return {
    ok: true,
    movedRecipes: editableIds.length,
    lockedRecipes: usage.locked,
    merged: Boolean(target),
    tagName: destination.name,
  };
}

/**
 * Takes a tag off the recipes this user may edit.
 *
 * Recipes are never deleted, and never modified beyond losing this one tag.
 * If the tag is left on recipes out of reach, the tag row survives.
 */
export function deleteTag(user: SessionUser, tagId: string): TagMutationResult {
  const tag = getTagById(tagId);
  if (!tag || !canSeeTag(user, tagId)) {
    return { ok: false, status: 404, error: "Tag not found." };
  }

  const usage = getTagUsage(user, tagId);
  if (usage.total > 0 && usage.editable === 0) {
    return {
      ok: false,
      status: 403,
      error:
        "You can't remove this tag — every recipe using it is one you're not allowed to edit.",
    };
  }

  const editableIds = editableRecipeIdsForTag(user, tagId);
  for (const recipeId of editableIds) {
    db.delete(recipeTags)
      .where(and(eq(recipeTags.recipeId, recipeId), eq(recipeTags.tagId, tagId)))
      .run();
  }

  if (usage.locked === 0) {
    db.delete(tags).where(eq(tags.id, tagId)).run();
  }

  return {
    ok: true,
    movedRecipes: editableIds.length,
    lockedRecipes: usage.locked,
    merged: false,
    tagName: tag.name,
  };
}

/** Creates a standalone tag, attached to nothing. */
export function createTag(
  user: SessionUser,
  name: string
): TagMutationResult {
  const display = normalizeTagName(name).slice(0, MAX_TAG_LENGTH);
  if (!display) return { ok: false, status: 400, error: "Enter a tag name." };

  const existing = db
    .select()
    .from(tags)
    .where(eq(tags.nameKey, tagKey(display)))
    .get();
  if (existing) {
    return {
      ok: false,
      status: 409,
      error: `A tag called "${existing.name}" already exists.`,
    };
  }

  ensureTag(display, user.id);
  return {
    ok: true,
    movedRecipes: 0,
    lockedRecipes: 0,
    merged: false,
    tagName: display,
  };
}
