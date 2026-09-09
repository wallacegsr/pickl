import type { Session } from "next-auth";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, recipes, type Recipe } from "@/db/schema";

export type SessionUser = Session["user"];

/**
 * A HOUSEHOLD administrator: runs one household's members, shared recipes and
 * settings.
 *
 * Unchanged in meaning — this is the role that already existed — but now
 * explicitly scoped to a household, because there is a second kind of admin.
 * Deliberately does NOT return true for a platform operator: see
 * `isPlatformAdmin`.
 */
export function isHouseholdAdmin(user: SessionUser | null | undefined): boolean {
  return user?.role === "admin";
}

/** @deprecated Prefer `isHouseholdAdmin`; kept while call sites migrate. */
export const isAdmin = isHouseholdAdmin;

/**
 * A PLATFORM operator: runs the deployment, not a family.
 *
 * They create, rename, suspend and delete households, and configure SMTP and
 * the OAuth client. They are explicitly NOT a super-user over household
 * contents.
 *
 * That is not enforced here, and deliberately so. Household content is reached
 * only through `householdScope`, which filters on the caller's own
 * `householdId`; an operator who is not a member of a household matches
 * nothing in it. Writing the rule as a check — "unless global admin" — would
 * put the guarantee one forgotten `if` away from leaking another family's
 * data. Absence of membership is a stronger guarantee than a condition.
 */
export function isPlatformAdmin(user: SessionUser | null | undefined): boolean {
  return Boolean(user?.isGlobalAdmin);
}

/**
 * The household whose data this user may touch, or null.
 *
 * Every household-scoped query must go through this rather than reading
 * `user.householdId` directly, so there is one place to audit and one place to
 * change. A null result means "no household content at all" — the correct
 * answer for a platform operator with no membership.
 */
export function householdScope(
  user: SessionUser | null | undefined
): string | null {
  return user?.householdId ?? null;
}

/** Whether this user may EDIT the shared household calendar (admins always can). */
export function canEditSharedCalendar(user: SessionUser | null | undefined): boolean {
  if (!user) return false;
  if (isAdmin(user)) return true;
  return Boolean(user.canAccessSharedCalendar);
}

/** Everyone may always VIEW the shared household calendar. */
export function canViewSharedCalendar(user: SessionUser | null | undefined): boolean {
  return Boolean(user);
}

/** Whether `user` may view/edit `targetUserId`'s private calendar. */
export function canAccessPrivateCalendar(
  user: SessionUser | null | undefined,
  targetUserId: string
): boolean {
  if (!user) return false;
  if (user.id === targetUserId) return true;
  return isAdmin(user);
}

export function canEditSharedRecipes(user: SessionUser | null | undefined): boolean {
  return isAdmin(user);
}

export function canEditRecipe(
  user: SessionUser | null | undefined,
  recipe: Pick<Recipe, "visibility" | "ownerUserId">
): boolean {
  if (!user) return false;
  if (recipe.visibility === "shared") return isAdmin(user);
  return recipe.ownerUserId === user.id;
}

/** Loads the full user row (for permission checks that need fresher-than-JWT data). */
export function getUserById(id: string) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

