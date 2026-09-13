import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { recipeFavorites, recipes } from "@/db/schema";
import type { SessionUser } from "@/lib/permissions";

/**
 * A person's starred recipes.
 *
 * Stars are per person (see recipe_favorites in the schema). Every read here
 * joins through `recipes` with the household predicate, so a star can never
 * surface a recipe from another household — even one left behind if a person
 * were moved between households — and a star on a recipe the reader can no
 * longer see simply stops counting.
 */

/** The ids of recipes this person has starred and can still see, as a set. */
export function favoriteRecipeIds(user: SessionUser, householdId: string): Set<string> {
  const rows = db
    .select({ id: recipeFavorites.recipeId })
    .from(recipeFavorites)
    .innerJoin(recipes, eq(recipes.id, recipeFavorites.recipeId))
    .where(
      and(
        eq(recipeFavorites.userId, user.id),
        eq(recipes.householdId, householdId),
        // A private recipe starred and then moved out of reach is not theirs to
        // spin from any more.
        or(eq(recipes.visibility, "shared"), eq(recipes.ownerUserId, user.id))
      )
    )
    .all();
  return new Set(rows.map((r) => r.id));
}

export type FavoriteResult =
  | { ok: true; favorite: boolean }
  | { ok: false; status: number; error: string };

/**
 * Stars or unstars one recipe. Idempotent: starring a starred recipe is fine.
 *
 * Deliberately NOT blocked by household suspension. A star is a personal
 * bookmark, in the same category as a theme or a password — it changes
 * nothing anyone else in the household sees — and suspension freezes the
 * household's shared content, not what one person has marked for themselves.
 */
export function setFavorite(
  user: SessionUser,
  householdId: string,
  recipeId: string,
  favorite: boolean
): FavoriteResult {
  // Looked up by id AND household AND visibility together: an id from another
  // household, or another member's private recipe, is simply not found — and
  // the answer does not reveal which of the two it was.
  const recipe = db
    .select({ id: recipes.id })
    .from(recipes)
    .where(
      and(
        eq(recipes.id, recipeId),
        eq(recipes.householdId, householdId),
        or(eq(recipes.visibility, "shared"), eq(recipes.ownerUserId, user.id))
      )
    )
    .get();
  if (!recipe) return { ok: false, status: 404, error: "Recipe not found." };

  if (favorite) {
    db.insert(recipeFavorites)
      .values({ userId: user.id, recipeId })
      .onConflictDoNothing()
      .run();
  } else {
    db.delete(recipeFavorites)
      .where(and(eq(recipeFavorites.userId, user.id), eq(recipeFavorites.recipeId, recipeId)))
      .run();
  }
  return { ok: true, favorite };
}

/** Which of these recipe ids this person has starred — for a page of results. */
export function favoritedAmong(user: SessionUser, recipeIds: string[]): Set<string> {
  if (recipeIds.length === 0) return new Set();
  const rows = db
    .select({ id: recipeFavorites.recipeId })
    .from(recipeFavorites)
    .where(and(eq(recipeFavorites.userId, user.id), inArray(recipeFavorites.recipeId, recipeIds)))
    .all();
  return new Set(rows.map((r) => r.id));
}
