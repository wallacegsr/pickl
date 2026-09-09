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
  householdOfUser,
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

function getLinkForEntry(targetId: string, planEntryId: string) {
  return db
    .select()
    .from(calendarEventLinks)
    .where(
      and(
        eq(calendarEventLinks.targetId, targetId),
        eq(calendarEventLinks.planEntryId, planEntryId)
      )
    )
    .get();
}

/**
 * Every link this target holds for one slot, however many recipes are in it.
 *
 * The slot, not the recipe, is the unit here because deciding what to delete
 * needs the links whose plan entry has already gone.
 */
function getLinksForSlot(targetId: string, date: string, mealType: MealType) {
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
    .all();
}

function saveLink(
  targetId: string,
  planEntryId: string,
  date: string,
  mealType: MealType,
  externalEventId: string,
  etag: string | null = null
) {
  const existing = getLinkForEntry(targetId, planEntryId);
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
      planEntryId,
      date,
      mealType,
      externalEventId,
      etag,
      lastPushedAt: new Date(),
    })
    .run();
}

function deleteLinkById(id: string) {
  db.delete(calendarEventLinks).where(eq(calendarEventLinks.id, id)).run();
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
/**
 * Reconciles one slot's external events against what is planned in it.
 *
 * A slot holds several recipes now, so this is add/update/delete over a set
 * rather than a single upsert-or-delete: each planned recipe gets its own
 * event, and any event whose recipe has left the slot is removed.
 */
export async function syncSlot(
  target: CalendarTarget,
  provider: CalendarProvider,
  date: string,
  mealType: MealType,
  planned: { entryId: string; recipe: Recipe }[]
): Promise<void> {
  const links = getLinksForSlot(target.id, date, mealType);

  // Links written before this table knew about plan entries have no entry id.
  // Adopting the first onto the first planned recipe re-keys the existing
  // event in place; without this its event would be deleted and an identical
  // one created, which for a user means the meal briefly vanishing from their
  // calendar and any reminder they set on it being lost.
  const legacy = links.filter((l) => !l.planEntryId);
  const byEntry = new Map(
    links.filter((l) => l.planEntryId).map((l) => [l.planEntryId as string, l])
  );
  const adopted = new Set<string>();
  legacy.forEach((link, index) => {
    const owner = planned[index];
    if (!owner) return;
    db.update(calendarEventLinks)
      .set({ planEntryId: owner.entryId })
      .where(eq(calendarEventLinks.id, link.id))
      .run();
    byEntry.set(owner.entryId, { ...link, planEntryId: owner.entryId });
    adopted.add(link.id);
  });

  // Anything still unclaimed belonged to a recipe that has left the slot.
  const stale = links.filter(
    (l) =>
      !adopted.has(l.id) &&
      (!l.planEntryId || !planned.some((p) => p.entryId === l.planEntryId))
  );
  for (const link of stale) {
    // The etag lets a provider refuse to delete an event the user has
    // edited since we wrote it (CalDAV does; Google ignores it).
    await provider.deleteEvent(link.externalEventId, link.etag);
    deleteLinkById(link.id);
  }

  for (const { entryId, recipe } of planned) {
    await syncPlannedRecipe(target, provider, date, mealType, entryId, recipe, byEntry.get(entryId));
  }
}

async function syncPlannedRecipe(
  target: CalendarTarget,
  provider: CalendarProvider,
  date: string,
  mealType: MealType,
  entryId: string,
  recipe: Recipe,
  link: { externalEventId: string; etag: string | null } | undefined
): Promise<void> {
  const { start, end } = getEventWindow(date, mealType);
  const input = {
    existingEventId: link?.externalEventId ?? null,
    existingEtag: link?.etag ?? null,
    // Identifies this planned recipe, so a provider that derives its own UID
    // (CalDAV) stays idempotent even if the link row disappears. The entry id
    // is part of it because two recipes in one slot would otherwise derive the
    // same UID and overwrite each other.
    slotKey: `${date}:${mealType}:${entryId}`,
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
    entryId,
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
  planned: { entryId: string; recipe: Recipe }[]
): Promise<void> {
  let account: CalendarAccount | null = null;
  try {
    if (!target.enabled) return;
    account = resolveAccount(target);
    if (!account) return;

    const provider = getProviderForTarget(target, account);
    await syncSlot(target, provider, date, mealType, planned);
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
  householdId: string,
  scope: Scope,
  userId?: string | null
): CalendarTarget[] {
  if (scope === "private") {
    if (!userId) return [];
    const target = getTargetForUserScope(userId, "private");
    return target && target.enabled ? [target] : [];
  }
  return getEnabledSharedTargets(householdId);
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
  householdId: string;
  scope: Scope;
  userId?: string | null;
  date: string;
  mealType: MealType;
}): Promise<void> {
  let targets: CalendarTarget[];
  try {
    targets = getTargetsForPlanWrite(input.householdId, input.scope, input.userId);
  } catch (err) {
    console.error("[calendar] could not resolve sync targets:", err);
    return;
  }
  if (targets.length === 0) return; // The normal case for most deployments.

  // Read the finished slot once, here, rather than per target: every target
  // pushes the same set of recipes, and this runs after the plan write has
  // committed.
  const { getSlotEntries } = await import("@/lib/plan");
  const planned = getSlotEntries(
    input.householdId,
    input.date,
    input.scope,
    input.userId ?? "",
    input.mealType
  )
    .map((entry) => {
      const recipe = getRecipe(entry.recipeId);
      return recipe ? { entryId: entry.id, recipe } : null;
    })
    .filter((p): p is { entryId: string; recipe: Recipe } => p !== null);

  await Promise.all(
    targets.map((target) =>
      pushSlotToTarget(target, input.date, input.mealType, planned).catch(
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
  householdId: string;
  scope: Scope;
  userId?: string | null;
  date: string;
  mealType: MealType;
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

  // Taken from the target's owner rather than passed in: a reconcile reads a
  // whole week of plan back out, and deriving the household here means no
  // caller can hand it the wrong one.
  const householdId = householdOfUser(target.userId);
  if (!householdId) {
    result.error = "This account is not part of a household.";
    return result;
  }

  try {
    const provider = getProviderForTarget(target, account);
    // Imported lazily to keep the plan <-> calendar module graph acyclic.
    const { getWeekPlan, MEAL_TYPE_LIST } = await import("@/lib/plan");
    const plan = getWeekPlan(
      householdId,
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
        planned: day.meals[mealType].recipes.map(({ entryId, recipe }) => ({
          entryId,
          recipe,
        })),
      }))
    );

    const outcomes = await mapWithConcurrency(
      jobs,
      MAX_CONCURRENT_PUSHES,
      async (job) => {
        // Counted per slot, as before. A slot with two recipes where one is
        // new and one already existed reports as "created" — the summary is a
        // progress report, not an audit, and splitting it per recipe would
        // make the numbers stop matching the week the user is looking at.
        const links = getLinksForSlot(target.id, job.date, job.mealType);
        if (job.planned.length === 0 && links.length === 0) {
          return "skipped" as const;
        }
        await syncSlot(target, provider, job.date, job.mealType, job.planned);
        if (job.planned.length === 0) return "deleted" as const;
        return links.length > 0 ? ("updated" as const) : ("created" as const);
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
