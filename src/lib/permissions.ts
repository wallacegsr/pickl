import type { Session } from "next-auth";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, recipes, type Recipe } from "@/db/schema";

export type SessionUser = Session["user"];

export function isAdmin(user: SessionUser | null | undefined): boolean {
  return user?.role === "admin";
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

export function countUsers(): number {
  const row = db.select().from(users).all();
  return row.length;
}
