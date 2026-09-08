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

/** One recipe planned into a slot. A slot can hold several. */
export interface PlannedRecipe {
  entryId: string;
  recipe: Recipe;
  position: number;
}

export interface PlanMealSlot {
  mealType: MealType;
  /**
   * Every recipe planned for this slot, in `position` order — a main and a
   * dessert, or two mains for a household cooking around an intolerance.
   *
   * This was `recipe: Recipe | null`, one per slot, enforced by a unique index
   * on (date, scope, userId, mealType). Anything reading a slot has to cope
   * with none, one, or several; an empty array is the "Empty jar" case that
   * `null` used to represent.
   */
  recipes: PlannedRecipe[];
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
    breakfast: { mealType: "breakfast", recipes: [] },
    lunch: { mealType: "lunch", recipes: [] },
    dinner: { mealType: "dinner", recipes: [] },
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
      // A row whose recipe has been deleted is skipped rather than shown as a
      // blank. It cannot normally exist — recipeId cascades — but a row
      // written before that cascade existed still can.
      const recipe = e.recipeId ? recipeMap.get(e.recipeId) : undefined;
      if (!recipe) continue;
      meals[mealType].recipes.push({
        entryId: e.id,
        recipe,
        position: e.position,
      });
    }
    // Stable order within each slot. SQLite makes no promise about row order
    // without an ORDER BY, so without this the main and the dessert could
    // swap places between two identical page loads.
    for (const slot of Object.values(meals)) {
      slot.recipes.sort(
        (a, b) => a.position - b.position || a.recipe.name.localeCompare(b.recipe.name)
      );
    }
    return { date: day.date, dayOfWeek: day.dayOfWeek, meals };
  });
}

/**
 * Every row in one slot, in `position` order.
 *
 * Replaces a `getPlanEntry` that returned a single row and could do so safely
 * only while the unique index guaranteed there was at most one. Callers that
 * want "is anything planned here?" should check `.length`.
 */
export function getSlotEntries(
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
    .orderBy(planEntries.position)
    .all();
}

export interface SetPlanEntryInput {
  date: string;
  scope: Scope;
  userId: string; // owner of the calendar (private) — ignored for shared
  mealType: MealType;
  /**
   * The recipes this slot should contain afterwards, in display order.
   *
   * This is a whole-slot statement rather than a single recipe: an empty array
   * clears the slot, one entry is the old behaviour, several is the new one.
   * Expressing it this way keeps one write path — the alternative, separate
   * add/remove calls, would have each needed its own audit and calendar
   * fan-out, and the two could drift.
   */
  recipeIds: string[];
  actingUserId: string; // who is making this change, for audit + createdByUserId
  action: AuditAction;
  notes?: string | null;
}

/**
 * The single write path for plan_entries. Reconciles a slot to the requested
 * set of recipes and always records audit rows, so this must be used by every
 * route that touches plan_entries (manual edits, spins).
 *
 * Reconciling rather than deleting-and-reinserting is deliberate: a recipe
 * that stays in the slot keeps its row, and therefore keeps the calendar event
 * link and shopping-list state hanging off that row. Clearing the slot and
 * rewriting it would orphan the external events and silently lose every
 * ticked-off ingredient on days where nothing actually changed.
 */
export function setPlanEntry(input: SetPlanEntryInput) {
  const owner = ownerKey(input.scope, input.userId);
  const existing = getSlotEntries(
    input.date,
    input.scope,
    input.userId,
    input.mealType
  );

  // Duplicates would violate the unique index; the last one wins, which
  // matches what picking the same recipe twice in the editor should mean.
  const wanted = [...new Set(input.recipeIds)];
  const existingByRecipe = new Map(
    existing.filter((e) => e.recipeId).map((e) => [e.recipeId as string, e])
  );

  const removed = existing.filter(
    (e) => !e.recipeId || !wanted.includes(e.recipeId)
  );
  for (const row of removed) {
    db.delete(planEntries).where(eq(planEntries.id, row.id)).run();
  }

  wanted.forEach((recipeId, index) => {
    const current = existingByRecipe.get(recipeId);
    if (current) {
      // Already here — only its place in the order can have changed.
      if (current.position !== index) {
        db.update(planEntries)
          .set({ position: index, updatedAt: new Date() })
          .where(eq(planEntries.id, current.id))
          .run();
      }
      return;
    }
    db.insert(planEntries)
      .values({
        id: randomUUID(),
        date: input.date,
        scope: input.scope,
        userId: owner,
        mealType: input.mealType,
        recipeId,
        position: index,
        createdByUserId: input.actingUserId,
      })
      .run();
  });

  // One audit row per recipe that actually entered or left the slot, so the
  // log still reads as a sequence of changes rather than one opaque "slot was
  // rewritten". A reorder alone is not a change worth logging.
  const added = wanted.filter((id) => !existingByRecipe.has(id));
  const auditBase = {
    userId: input.actingUserId,
    action: input.action,
    scope: input.scope,
    targetUserId: input.scope === "private" ? owner : null,
    date: input.date,
    mealType: input.mealType,
    notes: input.notes ?? null,
  };

  // A one-out-one-in slot is the common case and reads best as a replacement,
  // which is also exactly what the log recorded before slots could hold more
  // than one recipe.
  if (removed.length === 1 && added.length === 1) {
    logAuditEntry({
      ...auditBase,
      oldRecipeId: removed[0]!.recipeId ?? null,
      newRecipeId: added[0]!,
    });
  } else {
    for (const row of removed) {
      logAuditEntry({ ...auditBase, oldRecipeId: row.recipeId ?? null, newRecipeId: null });
    }
    for (const recipeId of added) {
      logAuditEntry({ ...auditBase, oldRecipeId: null, newRecipeId: recipeId });
    }
  }

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
      // The whole slot is pushed, not one recipe: the sync side has to add
      // events for what arrived, update what stayed and delete what left, and
      // it can only work that out from the finished state of the slot.
      schedulePlanSlotPush({
        scope: input.scope,
        userId: owner,
        date: input.date,
        mealType: input.mealType,
      })
    )
    .catch((err) => {
      console.error("[calendar] could not schedule push:", err);
    });

  return getSlotEntries(input.date, input.scope, input.userId, input.mealType);
}
