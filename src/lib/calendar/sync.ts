import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  calendarEventLinks,
  calendarTargets,
  recipes,
  type CalendarAccount,
  type CalendarTarget,
  type MealType,
  type Recipe,
  type Scope,
} from "@/db/schema";
import {
  MEAL_DEFAULT_HOUR,
  MEAL_LABELS,
  getWeekDays,
  parseDateString,
} from "@/lib/dates";
import {
  accountHasCredentials,
  getAccountById,
  getEnabledSharedTargets,
  getTargetForUserScope,
  setAccountError,
} from "./accounts";
import { getProviderForTarget } from "./index";
import {
  EventNotFoundError,
  ReauthRequiredError,
  type CalendarProvider,
  type UpsertEventResult,
} from "./types";

/**
 * Pushing planned meals out to users' external calendars.
 *
 * The cardinal rule, unchanged from the service-account era: **a calendar
 * outage must never make spinning a meal fail.** Every entry point catches
 * everything, records the problem on the target row (lastSyncError) and
 * resolves. The per-target "Sync now" button is the recovery path.
 *
 * What changed with per-user OAuth is the *shape* of a push. There is no
 * single household calendar any more — each user mirrors the household
 * plan into a calendar of their own. So one shared plan write fans out to
 * every user who has an enabled 'shared' target, while a private write
 * still touches exactly one (its owner's).
 *
 * **Concurrency, not batching.** A full-week spin in a 4-person household
 * is now dozens of writes, so they are not fired unthrottled. We cap
 * in-flight requests at MAX_CONCURRENT_PUSHES *per target* rather than
 * using Google's batch endpoint, because (a) every target authenticates
 * with a different user's access token, so a single batch request could
 * not span the fan-out anyway — batching would only help within one
 * target's week — and (b) Google has been actively discouraging the global
 * JSON batch endpoint. A ten-line semaphore is far less to get wrong than
 * multipart batch encoding, and targets themselves already run in
 * parallel, so the fan-out width is the concurrency.
 */

const MAX_CONCURRENT_PUSHES = 4;

/** Runs `worker` over `items` with at most `limit` in flight at a time. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

function recordSyncSuccess(targetId: string) {
  db.update(calendarTargets)
    .set({ lastSyncAt: new Date(), lastSyncError: null, updatedAt: new Date() })
    .where(eq(calendarTargets.id, targetId))
    .run();
}

function recordSyncError(targetId: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  db.update(calendarTargets)
    .set({ lastSyncError: message.slice(0, 1000), updatedAt: new Date() })
    .where(eq(calendarTargets.id, targetId))
    .run();
}

/** Event timing matches the ICS export exactly, so pushed events line up with exported ones. */
export function getEventWindow(date: string, mealType: MealType): {
  start: Date;
  end: Date;
} {
  const start = parseDateString(date);
  start.setHours(MEAL_DEFAULT_HOUR[mealType] ?? 18, 0, 0, 0);
  const end = new Date(start);
  end.setHours(start.getHours() + 1);
  return { start, end };
}

export function buildEventSummary(mealType: MealType, recipe: Recipe): string {
  return `${MEAL_LABELS[mealType] ?? mealType}: ${recipe.name}`;
}

/**
 * The event description. Empty unless the target opts in via
 * includeDetail — by default nothing but the meal title leaves the app.
 */
export function buildEventDescription(
  target: Pick<CalendarTarget, "includeDetail">,
  recipe: Recipe
): string | null {
  if (!target.includeDetail) return null;
  const ingredientsPreview = recipe.ingredients
    .split("\n")
    .filter(Boolean)
    .slice(0, 10)
    .join(", ");
  const parts = [
    ingredientsPreview ? `Ingredients: ${ingredientsPreview}` : null,
    recipe.instructions
      ? `Instructions: ${recipe.instructions.slice(0, 500)}`
      : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

function getLink(targetId: string, date: string, mealType: MealType) {
  return db
    .select()
    .from(calendarEventLinks)
    .where(
      and(
        eq(calendarEventLinks.targetId, targetId),
        eq(calendarEventLinks.date, date),
        eq(calendarEventLinks.mealType, mealType)
      )
    )
    .get();
}

function saveLink(
  targetId: string,
  date: string,
  mealType: MealType,
  externalEventId: string,
  etag: string | null = null
) {
  const existing = getLink(targetId, date, mealType);
  if (existing) {
    db.update(calendarEventLinks)
      .set({ externalEventId, etag, lastPushedAt: new Date() })
      .where(eq(calendarEventLinks.id, existing.id))
      .run();
    return;
  }
  db.insert(calendarEventLinks)
    .values({
      id: randomUUID(),
      targetId,
      date,
      mealType,
      externalEventId,
      etag,
      lastPushedAt: new Date(),
    })
    .run();
}

function deleteLink(targetId: string, date: string, mealType: MealType) {
  db.delete(calendarEventLinks)
    .where(
      and(
        eq(calendarEventLinks.targetId, targetId),
        eq(calendarEventLinks.date, date),
        eq(calendarEventLinks.mealType, mealType)
      )
    )
    .run();
}

function getRecipe(recipeId: string | null | undefined): Recipe | undefined {
  if (!recipeId) return undefined;
  return db.select().from(recipes).where(eq(recipes.id, recipeId)).get();
}

/**
 * Reconciles one plan slot with one target's remote calendar. Handles all
 * three transitions: create (no event yet), update (event exists), delete
 * (recipe cleared). Throws on provider failure — callers decide how to
 * record that.
 */
export async function syncSlot(
  target: CalendarTarget,
  provider: CalendarProvider,
  date: string,
  mealType: MealType,
  recipe: Recipe | null
): Promise<void> {
  const link = getLink(target.id, date, mealType);

  if (!recipe) {
    if (!link) return; // Nothing there, nothing to remove.
    // The etag lets a provider refuse to delete an event the user has
    // edited since we wrote it (CalDAV does; Google ignores it).
    await provider.deleteEvent(link.externalEventId, link.etag);
    deleteLink(target.id, date, mealType);
    return;
  }

  const { start, end } = getEventWindow(date, mealType);
  const input = {
    existingEventId: link?.externalEventId ?? null,
    existingEtag: link?.etag ?? null,
    // The slot's identity, so a provider that addresses events by a UID
    // it derives itself (CalDAV) stays idempotent even if this link row
    // disappears.
    slotKey: `${date}:${mealType}`,
    start,
    end,
    summary: buildEventSummary(mealType, recipe),
    description: buildEventDescription(target, recipe),
  };

  let result: UpsertEventResult;
  try {
    result = await provider.upsertEvent(input);
  } catch (err) {
    if (err instanceof EventNotFoundError) {
      // The event we had on file is gone remotely — create a fresh one
      // rather than staying permanently broken.
      result = await provider.upsertEvent({
        ...input,
        existingEventId: null,
        existingEtag: null,
      });
    } else {
      throw err;
    }
  }
  saveLink(
    target.id,
    date,
    mealType,
    result.externalEventId,
    result.etag ?? null
  );
}

/**
 * Resolves the account behind a target, or explains why the target can't
 * currently sync. Returns null (rather than throwing) for the ordinary
 * "not usable right now" cases.
 */
function resolveAccount(target: CalendarTarget): CalendarAccount | null {
  const account = getAccountById(target.accountId, target.userId);
  // Provider-agnostic: a Google account needs a refresh token, a CalDAV
  // account needs server/username/password.
  if (!account || !accountHasCredentials(account)) return null;
  return account;
}

/**
 * Failure bookkeeping shared by every push path: the message lands on the
 * target, and a dead authorization additionally lands on the account so
 * the UI can show one "Reconnect your Google account" banner rather than
 * two identical per-target errors.
 */
function recordFailure(target: CalendarTarget, account: CalendarAccount | null, err: unknown) {
  try {
    recordSyncError(target.id, err);
    if (account && err instanceof ReauthRequiredError) {
      setAccountError(account.id, err.message);
    }
  } catch (dbErr) {
    console.error("[calendar] could not record sync error:", dbErr);
  }
}

/** Pushes one slot to one target. Never throws. */
async function pushSlotToTarget(
  target: CalendarTarget,
  date: string,
  mealType: MealType,
  recipeId: string | null
): Promise<void> {
  let account: CalendarAccount | null = null;
  try {
    if (!target.enabled) return;
    account = resolveAccount(target);
    if (!account) return;

    const provider = getProviderForTarget(target, account);
    const recipe = getRecipe(recipeId) ?? null;
    await syncSlot(target, provider, date, mealType, recipe);
    recordSyncSuccess(target.id);
    if (account.lastError) setAccountError(account.id, null);
  } catch (err) {
    console.error("[calendar] push failed:", err);
    recordFailure(target, account, err);
  }
}

/**
 * Every target a plan write should reach.
 *
 *  - private: only the owning user's own private target;
 *  - shared:  every user's enabled shared target (the fan-out).
 */
export function getTargetsForPlanWrite(
  scope: Scope,
  userId?: string | null
): CalendarTarget[] {
  if (scope === "private") {
    if (!userId) return [];
    const target = getTargetForUserScope(userId, "private");
    return target && target.enabled ? [target] : [];
  }
  return getEnabledSharedTargets();
}

/**
 * Pushes a single plan slot to every target it belongs in.
 *
 * Non-fatal by construction: returns normally whether the pushes succeeded
 * or not, recording each failure on its own target row. Never throws. One
 * user's broken authorization cannot stop another user's calendar from
 * being updated.
 */
export async function pushPlanSlot(input: {
  scope: Scope;
  userId?: string | null;
  date: string;
  mealType: MealType;
  recipeId: string | null;
}): Promise<void> {
  let targets: CalendarTarget[];
  try {
    targets = getTargetsForPlanWrite(input.scope, input.userId);
  } catch (err) {
    console.error("[calendar] could not resolve sync targets:", err);
    return;
  }
  if (targets.length === 0) return; // The normal case for most deployments.

  await Promise.all(
    targets.map((target) =>
      pushSlotToTarget(target, input.date, input.mealType, input.recipeId).catch(
        (err) => {
          console.error("[calendar] unexpected per-target push error:", err);
        }
      )
    )
  );
}

/**
 * Fire-and-forget wrapper called from `setPlanEntry` after the DB write
 * has committed. Detached on purpose so a slow or dead calendar cannot
 * delay (or fail) the user's request, with a `.catch` so a rejection can
 * never surface as an unhandled promise rejection and take the process
 * down.
 */
export function schedulePlanSlotPush(input: {
  scope: Scope;
  userId?: string | null;
  date: string;
  mealType: MealType;
  recipeId: string | null;
}): void {
  void pushPlanSlot(input).catch((err) => {
    console.error("[calendar] unexpected push error:", err);
  });
}

export interface ResyncResult {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  error: string | null;
}

/**
 * Reconciles an entire Sun-Sat week for ONE target — the recovery path
 * behind that target's "Sync now" button, and the way to repair state
 * after a background push failed.
 *
 * Unlike the background push this reports its error to the caller (as well
 * as recording it), because the user is waiting on the answer.
 *
 * `ownerUserId` is the session user; the target must belong to them. The
 * caller is expected to have resolved the target through
 * `getOwnedTarget(userId, targetId)`, which is where the authorization
 * actually happens.
 */
export async function resyncWeek(
  target: CalendarTarget,
  weekReferenceDate: string
): Promise<ResyncResult> {
  const result: ResyncResult = {
    created: 0,
    updated: 0,
    deleted: 0,
    skipped: 0,
    error: null,
  };

  if (!target.enabled) {
    result.error = "This sync target is disabled — enable it before syncing.";
    return result;
  }

  const account = resolveAccount(target);
  if (!account) {
    // resolveAccount returned null because the credential is missing (or
    // the account is gone). Re-read the row purely to name the right
    // provider in the message — "reconnect Google" is unhelpful advice to
    // someone whose CalDAV password needs re-entering.
    const stranded = getAccountById(target.accountId, target.userId);
    result.error =
      stranded?.provider === "caldav"
        ? "This CalDAV connection is missing its credentials. Reconnect it under Preferences → Calendars."
        : "No Google authorization is stored. Connect your Google account again.";
    return result;
  }

  try {
    const provider = getProviderForTarget(target, account);
    // Imported lazily to keep the plan <-> calendar module graph acyclic.
    const { getWeekPlan, MEAL_TYPE_LIST } = await import("@/lib/plan");
    const plan = getWeekPlan(
      weekReferenceDate,
      target.scope as Scope,
      target.userId
    );

    // Flatten the week into one work list so the concurrency cap applies
    // across the whole reconcile rather than per day.
    const jobs = plan.flatMap((day) =>
      MEAL_TYPE_LIST.map((mealType) => ({
        date: day.date,
        mealType,
        recipe: day.meals[mealType].recipe,
      }))
    );

    const outcomes = await mapWithConcurrency(
      jobs,
      MAX_CONCURRENT_PUSHES,
      async (job) => {
        const link = getLink(target.id, job.date, job.mealType);
        if (!job.recipe && !link) return "skipped" as const;
        await syncSlot(target, provider, job.date, job.mealType, job.recipe);
        if (!job.recipe) return "deleted" as const;
        return link ? ("updated" as const) : ("created" as const);
      }
    );

    for (const outcome of outcomes) result[outcome] += 1;
    recordSyncSuccess(target.id);
    if (account.lastError) setAccountError(account.id, null);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    recordFailure(target, account, err);
  }

  return result;
}

/** Re-exported so callers don't need src/lib/dates for the week math. */
export { getWeekDays };
