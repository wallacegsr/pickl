import { randomUUID } from "node:crypto";
import { and, asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { shoppingListItems } from "@/db/schema";
import { getSundayOfWeek, toDateString } from "@/lib/dates";
import { ownerKey } from "@/lib/plan";
import type { PlanContext } from "@/lib/planContext";

/**
 * Shopping-list extras: things to buy that no planned recipe asked for.
 *
 * Every function takes the calendar (a resolved PlanContext) as well as any
 * item id, and matches on both. An id alone is never enough to reach an item,
 * so knowing one from another household's list — or someone's private list —
 * gets nowhere.
 */

export const MAX_EXTRA_LENGTH = 200;
/** A week's list is a list, not a database; this stops a runaway script, not a family. */
export const MAX_EXTRAS_PER_WEEK = 200;

export interface ShoppingExtra {
  id: string;
  text: string;
  onHand: boolean;
}

/** The Sunday that starts the week containing `date`: the key extras are stored under. */
export function weekKey(date: string): string {
  return toDateString(getSundayOfWeek(date));
}

function calendarMatch(context: PlanContext, week: string) {
  return and(
    eq(shoppingListItems.householdId, context.householdId),
    eq(shoppingListItems.scope, context.scope),
    eq(shoppingListItems.userId, ownerKey(context.scope, context.userId)),
    eq(shoppingListItems.week, week)
  );
}

/** The week's extras for one calendar, oldest first, so the list keeps the order things were added in. */
export function listExtras(context: PlanContext, date: string): ShoppingExtra[] {
  return db
    .select({ id: shoppingListItems.id, text: shoppingListItems.text, onHand: shoppingListItems.onHand })
    .from(shoppingListItems)
    .where(calendarMatch(context, weekKey(date)))
    .orderBy(asc(shoppingListItems.createdAt), asc(shoppingListItems.id))
    .all();
}

export type ExtraResult =
  | { ok: true; item: ShoppingExtra }
  | { ok: false; status: number; error: string };

export function addExtra(
  context: PlanContext,
  date: string,
  rawText: string,
  actingUserId: string
): ExtraResult {
  const text = rawText.replace(/\s+/g, " ").trim();
  if (!text) return { ok: false, status: 400, error: "Enter something to add." };
  if (text.length > MAX_EXTRA_LENGTH) {
    return { ok: false, status: 400, error: `Keep it under ${MAX_EXTRA_LENGTH} characters.` };
  }
  const week = weekKey(date);
  const existing = db
    .select({ n: count() })
    .from(shoppingListItems)
    .where(calendarMatch(context, week))
    .get();
  if ((existing?.n ?? 0) >= MAX_EXTRAS_PER_WEEK) {
    return { ok: false, status: 400, error: "This week's list is full." };
  }

  const now = new Date();
  const item = { id: randomUUID(), text, onHand: false };
  db.insert(shoppingListItems)
    .values({
      ...item,
      householdId: context.householdId,
      scope: context.scope,
      userId: ownerKey(context.scope, context.userId),
      week,
      createdByUserId: actingUserId,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return { ok: true, item };
}

/** The item, if it belongs to this calendar. Week is not part of the match: an id is unique. */
function findExtra(context: PlanContext, id: string) {
  return db
    .select()
    .from(shoppingListItems)
    .where(
      and(
        eq(shoppingListItems.id, id),
        eq(shoppingListItems.householdId, context.householdId),
        eq(shoppingListItems.scope, context.scope),
        eq(shoppingListItems.userId, ownerKey(context.scope, context.userId))
      )
    )
    .get();
}

export function setExtraOnHand(context: PlanContext, id: string, onHand: boolean): ShoppingExtra | null {
  const row = findExtra(context, id);
  if (!row) return null;
  db.update(shoppingListItems)
    .set({ onHand, updatedAt: new Date() })
    .where(eq(shoppingListItems.id, row.id))
    .run();
  return { id: row.id, text: row.text, onHand };
}

export function deleteExtra(context: PlanContext, id: string): boolean {
  const row = findExtra(context, id);
  if (!row) return false;
  db.delete(shoppingListItems).where(eq(shoppingListItems.id, row.id)).run();
  return true;
}
