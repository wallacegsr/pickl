import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  households,
  recipes,
  planEntries,
  users,
  type Household,
} from "@/db/schema";

/**
 * Households as OBJECTS — the platform operator's view.
 *
 * Everything in this module deals in a household's name, size and lifecycle.
 * Nothing here reads a household's contents, and nothing here should ever be
 * given the ability to: an operator runs the deployment, not the families on
 * it. The counts below are the deliberate limit of what the panel shows —
 * enough to tell a busy household from an abandoned one, or to see what a
 * deletion would destroy, and not one recipe title more.
 *
 * The privacy guarantee itself is not enforced here. It is structural: every
 * household query filters on the caller's own `householdId`, and an operator
 * has none, so they match nothing. See src/lib/permissions.ts.
 */

export interface HouseholdSummary {
  id: string;
  name: string;
  suspended: boolean;
  createdAt: string;
  /** How many accounts belong to it, and how much they have made. */
  memberCount: number;
  recipeCount: number;
  plannedMealCount: number;
  /** True when this household contains the deployment's global admin. */
  holdsGlobalAdmin: boolean;
}

function toCountMap(rows: { householdId: string | null; count: number }[]) {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.householdId) map.set(row.householdId, Number(row.count));
  }
  return map;
}

export function listHouseholds(): HouseholdSummary[] {
  const rows = db.select().from(households).orderBy(households.name).all();

  // One grouped query per table rather than three per household.
  const memberCounts = toCountMap(
    db
      .select({ householdId: users.householdId, count: sql<number>`count(*)` })
      .from(users)
      .groupBy(users.householdId)
      .all()
  );
  const recipeCounts = toCountMap(
    db
      .select({ householdId: recipes.householdId, count: sql<number>`count(*)` })
      .from(recipes)
      .groupBy(recipes.householdId)
      .all()
  );
  const plannedCounts = toCountMap(
    db
      .select({ householdId: planEntries.householdId, count: sql<number>`count(*)` })
      .from(planEntries)
      .groupBy(planEntries.householdId)
      .all()
  );

  const globalAdminHousehold = globalAdminHouseholdId();

  return rows.map((h) => ({
    id: h.id,
    name: h.name,
    suspended: h.suspended,
    createdAt: h.createdAt.toISOString(),
    memberCount: memberCounts.get(h.id) ?? 0,
    recipeCount: recipeCounts.get(h.id) ?? 0,
    plannedMealCount: plannedCounts.get(h.id) ?? 0,
    holdsGlobalAdmin: globalAdminHousehold === h.id,
  }));
}

export function getHousehold(id: string): Household | undefined {
  return db.select().from(households).where(eq(households.id, id)).get();
}

export type HouseholdResult =
  | { ok: true; household: Household }
  | { ok: false; status: number; error: string };

function cleanName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, 80);
}

export function createHousehold(name: string): HouseholdResult {
  const clean = cleanName(name);
  if (!clean) return { ok: false, status: 400, error: "Enter a household name." };

  const id = randomUUID();
  db.insert(households).values({ id, name: clean }).run();
  return { ok: true, household: getHousehold(id)! };
}

/**
 * Renames a household. Used by both admins — an operator from the households
 * panel, a household admin on their own household — because a name is the one
 * household-level thing that is not private: the operator already sees it.
 */
export function renameHousehold(id: string, name: string): HouseholdResult {
  const clean = cleanName(name);
  if (!clean) return { ok: false, status: 400, error: "Enter a household name." };

  const existing = getHousehold(id);
  if (!existing) return { ok: false, status: 404, error: "Household not found." };

  db.update(households)
    .set({ name: clean, updatedAt: new Date() })
    .where(eq(households.id, id))
    .run();
  return { ok: true, household: getHousehold(id)! };
}

export function setHouseholdSuspended(
  id: string,
  suspended: boolean
): HouseholdResult {
  const existing = getHousehold(id);
  if (!existing) return { ok: false, status: 404, error: "Household not found." };

  // Suspending the household the deployment's operator lives in would lock
  // them out of their own family's data with no way back except the database.
  if (suspended && holdsGlobalAdmin(id)) {
    return {
      ok: false,
      status: 400,
      error: "This household contains the global admin and cannot be suspended.",
    };
  }

  db.update(households)
    .set({ suspended, updatedAt: new Date() })
    .where(eq(households.id, id))
    .run();
  return { ok: true, household: getHousehold(id)! };
}

/**
 * The household the deployment's operator belongs to, if any.
 *
 * Suspending or deleting it would lock the operator out of — or destroy —
 * the account that administers the deployment, with nothing but the database
 * left to fix it with.
 */
function holdsGlobalAdmin(householdId: string): boolean {
  return globalAdminHouseholdId() === householdId;
}

function globalAdminHouseholdId(): string | null {
  return (
    db
      .select({ householdId: users.householdId })
      .from(users)
      .where(eq(users.isGlobalAdmin, true))
      .get()?.householdId ?? null
  );
}

/**
 * Deletes a household and everything in it.
 *
 * Every household-scoped table cascades from this row, so this destroys the
 * members' accounts along with the recipes, plans and history. There is no
 * undo and no export, so the caller must pass the household's exact name
 * back — the same shape as every other irreversible button, and the reason
 * it is a name rather than a checkbox is that a name cannot be clicked by
 * accident.
 */
export function deleteHousehold(
  id: string,
  confirmName: string
): HouseholdResult {
  const existing = getHousehold(id);
  if (!existing) return { ok: false, status: 404, error: "Household not found." };

  if (confirmName.trim() !== existing.name) {
    return {
      ok: false,
      status: 400,
      error: `Type the household's name exactly ("${existing.name}") to delete it.`,
    };
  }

  if (holdsGlobalAdmin(id)) {
    return {
      ok: false,
      status: 400,
      error:
        "This household contains the global admin. Deleting it would delete the account that administers this deployment.",
    };
  }

  db.delete(households).where(eq(households.id, id)).run();
  return { ok: true, household: existing };
}

/** Whether this household is suspended — checked on every household write. */
export function isSuspended(householdId: string): boolean {
  return Boolean(getHousehold(householdId)?.suspended);
}

export const SUSPENDED_MESSAGE =
  "This household is suspended. You can still sign in and read what is here, but nothing can be changed until it is resumed.";

/**
 * The error to return from a write path when the household is suspended, or
 * null when the write may proceed.
 *
 * Reads are deliberately unaffected. A suspended household keeps its recipes,
 * its plan and its history readable, so suspension is a pause rather than a
 * confiscation, and resuming restores the household exactly as it was.
 */
export function suspensionError(
  householdId: string
): { status: number; error: string } | null {
  return isSuspended(householdId)
    ? { status: 403, error: SUSPENDED_MESSAGE }
    : null;
}
