import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { planEntries, recipes, type Recipe, type MealType, type Scope } from "@/db/schema";
import { getWeekDays } from "@/lib/dates";
import { logAuditEntry, type AuditAction } from "@/lib/audit";

export const MEAL_TYPE_LIST: MealType[] = ["breakfast", "lunch", "dinner"];

/** The scoping key stored in plan_entries.userId: '' for shared, the owner's id for private. */
export function ownerKey(scope: Scope, userId?: string | null): string {
  return scope === "private" ? userId ?? "" : "";
}

export interface PlanMealSlot {
  mealType: MealType;
  entryId: string | null;
  recipe: Recipe | null;
}

export interface PlanDay {
  date: string;
  dayOfWeek: string;
  meals: Record<MealType, PlanMealSlot>;
}

/** Fisher-Yates shuffle, returns a new array. */
export function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** All recipes, unfiltered (used for admin management views). */
export function getAllRecipes(): Recipe[] {
  return db.select().from(recipes).all();
}

/**
 * The eligible recipe pool for a given calendar (scope) + meal type:
 *  - shared calendar => shared recipes only
 *  - private calendar => shared recipes + that user's own private recipes
 * A recipe tagged "any" is eligible for every meal.
 */
export function getRecipePool(
  scope: Scope,
  userId: string,
  mealType: MealType
): Recipe[] {
  const all = db.select().from(recipes).all();
  const pool = all.filter((r) => {
    const visibleInScope =
      r.visibility === "shared" ||
      (scope === "private" && r.visibility === "private" && r.ownerUserId === userId);
    if (!visibleInScope) return false;
    const tags = r.mealType
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    return tags.includes(mealType) || tags.includes("any");
  });
  // Alphabetical by name, so anything listing the pool is browsable. `numeric`
  // keeps "Chili 2" ahead of "Chili 10"; `base` sensitivity stops capitalised
  // names from sorting into their own block ahead of the lower-case ones.
  return pool.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
  );
}

function emptyMeals(): Record<MealType, PlanMealSlot> {
  return {
    breakfast: { mealType: "breakfast", entryId: null, recipe: null },
    lunch: { mealType: "lunch", entryId: null, recipe: null },
    dinner: { mealType: "dinner", entryId: null, recipe: null },
  };
}

/** Fetches the full Sun-Sat week for a given calendar (scope + owner). */
export function getWeekPlan(
  referenceDate: string,
  scope: Scope,
  userId: string
): PlanDay[] {
  const weekDays = getWeekDays(referenceDate);
  const dates = weekDays.map((d) => d.date);
  const owner = ownerKey(scope, userId);

  const entries = db
    .select()
    .from(planEntries)
    .where(
      and(
        inArray(planEntries.date, dates),
        eq(planEntries.scope, scope),
        eq(planEntries.userId, owner)
      )
    )
    .all();

  const recipeIds = entries
    .map((e) => e.recipeId)
    .filter((id): id is string => Boolean(id));

  const recipeMap = new Map<string, Recipe>();
  if (recipeIds.length > 0) {
    const foundRecipes = db
      .select()
      .from(recipes)
      .where(inArray(recipes.id, recipeIds))
      .all();
    for (const r of foundRecipes) recipeMap.set(r.id, r);
  }

  const byDate = new Map<string, typeof entries>();
  for (const e of entries) {
    const list = byDate.get(e.date) ?? [];
    list.push(e);
    byDate.set(e.date, list);
  }

  return weekDays.map((day) => {
    const meals = emptyMeals();
    for (const e of byDate.get(day.date) ?? []) {
      const mealType = e.mealType as MealType;
      if (!(mealType in meals)) continue;
      meals[mealType] = {
        mealType,
        entryId: e.id,
        recipe: e.recipeId ? recipeMap.get(e.recipeId) ?? null : null,
      };
    }
    return { date: day.date, dayOfWeek: day.dayOfWeek, meals };
  });
}

export function getPlanEntry(
  date: string,
  scope: Scope,
  userId: string,
  mealType: MealType
) {
  const owner = ownerKey(scope, userId);
  return db
    .select()
    .from(planEntries)
    .where(
      and(
        eq(planEntries.date, date),
        eq(planEntries.scope, scope),
        eq(planEntries.userId, owner),
        eq(planEntries.mealType, mealType)
      )
    )
    .get();
}

export interface SetPlanEntryInput {
  date: string;
  scope: Scope;
  userId: string; // owner of the calendar (private) — ignored for shared
  mealType: MealType;
  recipeId: string | null;
  actingUserId: string; // who is making this change, for audit + createdByUserId
  action: AuditAction;
  notes?: string | null;
}

/**
 * The single write path for plan_entries. Inserts or updates the entry and
 * always records an audit_log row (old recipe -> new recipe), so this must
 * be used by every route that touches plan_entries (manual edits, spins).
 */
export function setPlanEntry(input: SetPlanEntryInput) {
  const owner = ownerKey(input.scope, input.userId);
  const existing = getPlanEntry(input.date, input.scope, input.userId, input.mealType);

  if (existing) {
    db.update(planEntries)
      .set({
        recipeId: input.recipeId,
        createdByUserId: input.actingUserId,
        updatedAt: new Date(),
      })
      .where(eq(planEntries.id, existing.id))
      .run();
  } else {
    db.insert(planEntries)
      .values({
        id: randomUUID(),
        date: input.date,
        scope: input.scope,
        userId: owner,
        mealType: input.mealType,
        recipeId: input.recipeId,
        createdByUserId: input.actingUserId,
      })
      .run();
  }

  logAuditEntry({
    userId: input.actingUserId,
    action: input.action,
    scope: input.scope,
    targetUserId: input.scope === "private" ? owner : null,
    date: input.date,
    mealType: input.mealType,
    oldRecipeId: existing?.recipeId ?? null,
    newRecipeId: input.recipeId,
    notes: input.notes ?? null,
  });

  // Push to every external calendar this write belongs in, AFTER the DB
  // write has committed and detached from this request.
  //
  // For a private entry that is at most one target (its owner's). For a
  // shared/household entry it FANS OUT to every user who mirrors the
  // household plan into a calendar of their own — there is no single
  // shared calendar any more.
  //
  // This is deliberately fire-and-forget: a calendar outage must never
  // make spinning or editing a meal fail, and must never delay the
  // response. Failures are recorded per target in
  // calendar_targets.lastSyncError and repaired via that target's "Sync
  // now" button in Preferences → Calendars. The dynamic import keeps the
  // plan <-> calendar module graph acyclic.
  import("@/lib/calendar/sync")
    .then(({ schedulePlanSlotPush }) =>
      schedulePlanSlotPush({
        scope: input.scope,
        userId: owner,
        date: input.date,
        mealType: input.mealType,
        recipeId: input.recipeId,
      })
    )
    .catch((err) => {
      console.error("[calendar] could not schedule push:", err);
    });

  return getPlanEntry(input.date, input.scope, input.userId, input.mealType);
}
