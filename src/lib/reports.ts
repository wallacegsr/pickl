import { and, eq, gte, lt, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLog,
  isDessertRecipe,
  planEntries,
  recipes,
  users,
  type MealType,
  type Recipe,
  type Scope,
} from "@/db/schema";
import { householdScope, isAdmin, type SessionUser } from "@/lib/permissions";
import { parseDateString, todayDateString, getSundayOfWeek, toDateString } from "@/lib/dates";
import { getTagsForRecipes } from "@/lib/tags";
import { tagKey } from "@/lib/tagNames";

export interface ReportFilters {
  startDate?: string;
  endDate?: string;
  scope?: Scope;
  mealType?: MealType;
  userId?: string; // admin-only: restrict to one user's private data
  /** Tag name; matched case-insensitively, as tags are everywhere else. */
  tag?: string;
}

export interface MealHistoryRow {
  date: string;
  mealType: string;
  scope: string;
  recipeId: string | null;
  recipeName: string | null;
  plannedByName: string | null;
  ownerName: string | null; // whose calendar (private only)
  /** Tag names on the recipe, for the tag column and the tag filter. */
  tags: string[];
}

/**
 * Recipe and user-name lookups for one household.
 *
 * These maps resolve ids into names for display, so unscoped they were the
 * quietest leak in the app: no report ever listed another household's rows,
 * but the maps behind them held every recipe title and every member's name
 * on the deployment, one stray id away from being printed.
 */
function loadLookups(householdId: string) {
  const allRecipes = db
    .select()
    .from(recipes)
    .where(eq(recipes.householdId, householdId))
    .all();
  const allUsers = db
    .select()
    .from(users)
    .where(eq(users.householdId, householdId))
    .all();
  const recipeMap = new Map(allRecipes.map((r) => [r.id, r]));
  const userMap = new Map(allUsers.map((u) => [u.id, u]));
  return { recipeMap, userMap };
}

function dateRangeConditions(householdId: string, filters: ReportFilters) {
  const conditions = [eq(planEntries.householdId, householdId)];
  if (filters.startDate) conditions.push(gte(planEntries.date, filters.startDate));
  if (filters.endDate) conditions.push(lte(planEntries.date, filters.endDate));
  return conditions;
}

/** Entries visible to `requestingUser` given their role: admins see everything;
 * members see shared entries plus their own private entries. */
function isEntryVisible(
  requestingUser: SessionUser,
  entry: { scope: string; userId: string }
): boolean {
  if (isAdmin(requestingUser)) return true;
  if (entry.scope === "shared") return true;
  return entry.userId === requestingUser.id;
}

export function getMealHistory(
  requestingUser: SessionUser,
  filters: ReportFilters
): MealHistoryRow[] {
  const householdId = householdScope(requestingUser);
  if (!householdId) return [];

  const conditions = dateRangeConditions(householdId, filters);
  const rows = db
    .select()
    .from(planEntries)
    .where(and(...conditions))
    .all();

  const { recipeMap, userMap } = loadLookups(householdId);
  // One query for the whole report rather than one per row.
  const tagsByRecipe = getTagsForRecipes(
    householdId,
    [...new Set(rows.map((e) => e.recipeId).filter((id): id is string => Boolean(id)))]
  );
  const wantedTag = filters.tag ? tagKey(filters.tag) : null;

  return rows
    .filter((e) => isEntryVisible(requestingUser, e))
    .filter((e) => (filters.scope ? e.scope === filters.scope : true))
    .filter((e) => (filters.mealType ? e.mealType === filters.mealType : true))
    .filter((e) => {
      if (!filters.userId) return true;
      if (!isAdmin(requestingUser)) return true; // non-admins can't target others
      return e.scope === "private" ? e.userId === filters.userId : true;
    })
    .filter((e) => e.recipeId !== null)
    .filter((e) => {
      if (!wantedTag) return true;
      const names = e.recipeId ? tagsByRecipe.get(e.recipeId) ?? [] : [];
      return names.some((n) => tagKey(n) === wantedTag);
    })
    .map((e) => ({
      date: e.date,
      mealType: e.mealType,
      scope: e.scope,
      recipeId: e.recipeId,
      recipeName: e.recipeId ? recipeMap.get(e.recipeId)?.name ?? null : null,
      plannedByName: e.createdByUserId
        ? userMap.get(e.createdByUserId)?.name ?? null
        : null,
      ownerName: e.scope === "private" ? userMap.get(e.userId)?.name ?? null : null,
      tags: e.recipeId ? tagsByRecipe.get(e.recipeId) ?? [] : [],
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.mealType.localeCompare(b.mealType));
}

export interface RecipeFrequencyRow {
  recipeId: string;
  recipeName: string;
  scope: string; // 'shared' | 'private' | 'mixed'
  count: number;
  /** Most recent date this recipe was planned for, or null if never. */
  lastPlanned: string | null;
  /** Days from `lastPlanned` to today; null when never planned. */
  daysSince: number | null;
  /**
   * Times planned per 30 days across the reported span, or null when the span
   * is too short to be worth extrapolating from.
   *
   * A raw count cannot be compared between a three-week range and a
   * three-month one, which is exactly what someone does when they narrow a
   * report and wonder whether a recipe is creeping up.
   */
  perMonth: number | null;
}

/** Recipes this user can see: the shared pool plus their own private ones. */
function visibleRecipes(requestingUser: SessionUser) {
  const householdId = householdScope(requestingUser);
  if (!householdId) return [];
  return db
    .select()
    .from(recipes)
    .where(
      and(
        eq(recipes.householdId, householdId),
        or(
          eq(recipes.visibility, "shared"),
          eq(recipes.ownerUserId, requestingUser.id)
        )
      )
    )
    .all();
}

/** Whole days between two YYYY-MM-DD dates. */
function daysBetween(from: string, to: string): number {
  return Math.round(
    (parseDateString(to).getTime() - parseDateString(from).getTime()) / 86_400_000
  );
}

export function getRecipeFrequency(
  requestingUser: SessionUser,
  filters: ReportFilters
): RecipeFrequencyRow[] {
  const history = getMealHistory(requestingUser, filters);
  const counts = new Map<
    string,
    { name: string; scopes: Set<string>; count: number; last: string | null }
  >();

  for (const row of history) {
    if (!row.recipeId || !row.recipeName) continue;
    const existing = counts.get(row.recipeId);
    if (existing) {
      existing.count += 1;
      existing.scopes.add(row.scope);
      if (!existing.last || row.date > existing.last) existing.last = row.date;
    } else {
      counts.set(row.recipeId, {
        name: row.recipeName,
        scopes: new Set([row.scope]),
        count: 1,
        last: row.date,
      });
    }
  }

  // Recipes that were never planned are the point of the report, not an
  // omission: "what haven't we cooked?" cannot be answered from the plan
  // alone, because a recipe nobody has ever chosen leaves no trace there.
  //
  // Their last-planned date is looked up across ALL history rather than the
  // filtered range, so a recipe absent from the last month still reports when
  // it was last actually cooked instead of a bare "never".
  const everyPlanned = filters.startDate || filters.endDate || filters.scope || filters.mealType
    ? getMealHistory(requestingUser, {})
    : history;
  const lastEver = new Map<string, string>();
  for (const row of everyPlanned) {
    if (!row.recipeId) continue;
    const seen = lastEver.get(row.recipeId);
    if (!seen || row.date > seen) lastEver.set(row.recipeId, row.date);
  }

  const today = todayDateString();

  // The span the rate is measured over: the requested range when given,
  // otherwise the range the data itself covers.
  const spanStart =
    filters.startDate ??
    everyPlanned.reduce<string | null>(
      (min, r) => (min === null || r.date < min ? r.date : min),
      null
    );
  const spanEnd = filters.endDate ?? today;
  const spanDays =
    spanStart && spanEnd ? Math.max(daysBetween(spanStart, spanEnd), 0) + 1 : 0;
  // Below a fortnight, "times per month" is an extrapolation from too little
  // to mean anything, and a recipe cooked once would read as twice a month.
  const rateApplies = spanDays >= 14;

  const rows: RecipeFrequencyRow[] = visibleRecipes(requestingUser).map((recipe) => {
    const tally = counts.get(recipe.id);
    const last = lastEver.get(recipe.id) ?? null;
    return {
      recipeId: recipe.id,
      recipeName: recipe.name,
      scope: tally
        ? tally.scopes.size > 1
          ? "mixed"
          : Array.from(tally.scopes)[0]
        : recipe.visibility,
      count: tally?.count ?? 0,
      lastPlanned: last,
      daysSince: last ? daysBetween(last, today) : null,
      perMonth:
        rateApplies && tally
          ? Math.round((tally.count / spanDays) * 30.44 * 10) / 10
          : null,
    };
  });

  return rows.sort(
    (a, b) =>
      b.count - a.count ||
      a.recipeName.localeCompare(b.recipeName, undefined, { sensitivity: "base" })
  );
}

export interface AuditLogRow {
  id: string;
  timestamp: string;
  userName: string | null;
  action: string;
  scope: string | null;
  targetUserName: string | null;
  date: string | null;
  mealType: string | null;
  oldRecipeName: string | null;
  newRecipeName: string | null;
  notes: string | null;
}

export interface AuditLogFilters {
  startDate?: string;
  endDate?: string;
  /**
   * The range as absolute instants, in epoch milliseconds: `startAt` inclusive,
   * `endBefore` exclusive.
   *
   * Sent by the browser, which computes them from the picked dates in ITS OWN
   * timezone. Preferred over startDate/endDate, and the reason is a bug that
   * survived one fix already.
   *
   * "All of 8 September" is not a fact about an instant; it depends on who is
   * asking. Deriving it server-side used the server's zone, which in a
   * container is UTC — so for a viewer in Los Angeles the day ended at 5pm
   * their time, and everything they did that evening fell outside a range that
   * named their own date. The browser is the only party that knows which
   * instants the user means, so it decides, and this side does no zone maths
   * at all.
   */
  startAt?: number;
  endBefore?: number;
  action?: string;
  userId?: string; // admin-only: restrict to actions by/about one user
  /** Drop everything that is not a change to the plan itself. */
  planChangesOnly?: boolean;
}

/**
 * Actions that change what is on the calendar.
 *
 * Everything else in the log — tag admin, recipe edits, theme changes — is
 * housekeeping, and is what buries the answer when the question is "who moved
 * dinner?".
 */
const PLAN_CHANGE_ACTIONS = new Set([
  "spin_today",
  "spin_week",
  "manual_set",
  "manual_clear",
]);

export function getAuditLogReport(
  requestingUser: SessionUser,
  filters: AuditLogFilters
): AuditLogRow[] {
  // Filtered on WHEN THE ACTION HAPPENED, not on the plan date it refers to.
  //
  // This used to compare `auditLog.date`, which is the date of the meal an
  // entry is about and is null for everything that is not a plan edit. That
  // dropped every tag edit, recipe edit and theme change out of any dated
  // report — a null fails both comparisons — and judged the rest by the day
  // they planned FOR rather than the day they were made, so a Monday shake
  // that filled the rest of the week vanished from a Monday-to-Tuesday range.
  //
  // The other two reports are about planned meals, so they still filter on the
  // plan date (see dateRangeConditions). This one is a log of actions.
  const householdId = householdScope(requestingUser);
  if (!householdId) return [];

  const conditions = [eq(auditLog.householdId, householdId)];

  // The browser's instants win when it sends them. The date-string path stays
  // as a fallback for a direct API call, but it can only interpret a day in
  // the server's own zone, which is the very thing that made this wrong.
  const startAt =
    filters.startAt !== undefined
      ? new Date(filters.startAt)
      : filters.startDate
        ? parseDateString(filters.startDate)
        : null;

  let endBefore: Date | null = null;
  if (filters.endBefore !== undefined) {
    endBefore = new Date(filters.endBefore);
  } else if (filters.endDate) {
    // The end date is inclusive of the whole day, so the bound is midnight at
    // the START of the following day and the comparison is exclusive. An lte
    // against the end date's own midnight would return only actions taken in
    // its first instant.
    const dayAfterEnd = parseDateString(filters.endDate);
    dayAfterEnd.setDate(dayAfterEnd.getDate() + 1);
    endBefore = dayAfterEnd;
  }

  if (startAt) conditions.push(gte(auditLog.timestamp, startAt));
  if (endBefore) conditions.push(lt(auditLog.timestamp, endBefore));

  const rows = db
    .select()
    .from(auditLog)
    .where(and(...conditions))
    .all();

  const { recipeMap, userMap } = loadLookups(householdId);

  return rows
    .filter((r) => {
      if (isAdmin(requestingUser)) return true;
      return r.userId === requestingUser.id || r.targetUserId === requestingUser.id;
    })
    .filter((r) => (filters.action ? r.action === filters.action : true))
    .filter((r) => (filters.planChangesOnly ? PLAN_CHANGE_ACTIONS.has(r.action) : true))
    .filter((r) => (filters.userId && isAdmin(requestingUser) ? r.userId === filters.userId || r.targetUserId === filters.userId : true))
    .map((r) => ({
      id: r.id,
      timestamp: r.timestamp.toISOString(),
      userName: userMap.get(r.userId)?.name ?? null,
      action: r.action,
      scope: r.scope,
      targetUserName: r.targetUserId ? userMap.get(r.targetUserId)?.name ?? null : null,
      date: r.date,
      mealType: r.mealType,
      oldRecipeName: r.oldRecipeId ? recipeMap.get(r.oldRecipeId)?.name ?? "(deleted recipe)" : null,
      newRecipeName: r.newRecipeId ? recipeMap.get(r.newRecipeId)?.name ?? "(deleted recipe)" : null,
      notes: r.notes,
    }))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv<T extends object>(headers: (keyof T & string)[], rows: T[]): string {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Patterns: the "how do we actually eat?" report.
//
// Five small answers rather than one table, because each is a single number or
// a short list and none of them justifies a tab of its own. They share one
// pass over the same filtered history, so adding them costs one request.
// ---------------------------------------------------------------------------

export interface CoverageRow {
  mealType: string;
  planned: number;
  /** Days in the reported span — the number of slots that COULD be filled. */
  possible: number;
  percent: number;
}

export interface WeekdayCookTimeRow {
  /** 0 = Sunday, matching the app's week. */
  weekday: number;
  weekdayName: string;
  meals: number;
  /** Mean prep + cook minutes, over the meals that state a time. */
  averageMinutes: number | null;
  /** How many of `meals` actually carried a time — the honesty column. */
  withTimes: number;
}

export interface TagMixRow {
  tag: string;
  count: number;
  percent: number;
}

export interface PlannerRow {
  userName: string;
  count: number;
  percent: number;
}

export interface PatternsReport {
  spanStart: string | null;
  spanEnd: string | null;
  spanDays: number;
  totalMeals: number;
  coverage: CoverageRow[];
  weekdays: WeekdayCookTimeRow[];
  tagMix: TagMixRow[];
  /** Untagged meals, so the tag mix does not imply it covers everything. */
  untaggedMeals: number;
  dessertMeals: number;
  dessertsPerWeek: number | null;
  planners: PlannerRow[];
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function getPatternsReport(
  requestingUser: SessionUser,
  filters: ReportFilters
): PatternsReport {
  const householdId = householdScope(requestingUser);
  const history = getMealHistory(requestingUser, filters);
  const { recipeMap } = householdId
    ? loadLookups(householdId)
    : { recipeMap: new Map<string, Recipe>() };

  const dates = history.map((r) => r.date).sort();
  const spanStart = filters.startDate ?? dates[0] ?? null;
  const spanEnd = filters.endDate ?? dates[dates.length - 1] ?? null;
  const spanDays =
    spanStart && spanEnd ? Math.max(daysBetween(spanStart, spanEnd), 0) + 1 : 0;

  // --- Coverage -----------------------------------------------------------
  // Counted per DAY, not per row: two recipes in one dinner is still one
  // dinner planned, and counting rows would report more than 100%.
  const plannedDays = new Map<string, Set<string>>();
  for (const row of history) {
    const set = plannedDays.get(row.mealType) ?? new Set<string>();
    set.add(row.date);
    plannedDays.set(row.mealType, set);
  }
  const coverage: CoverageRow[] = (["breakfast", "lunch", "dinner"] as const).map(
    (mealType) => {
      const planned = plannedDays.get(mealType)?.size ?? 0;
      return {
        mealType,
        planned,
        possible: spanDays,
        percent: spanDays > 0 ? Math.round((planned / spanDays) * 100) : 0,
      };
    }
  );

  // --- Cook time by weekday ------------------------------------------------
  const byWeekday = new Map<number, { meals: number; minutes: number; withTimes: number }>();
  for (const row of history) {
    const weekday = parseDateString(row.date).getDay();
    const bucket = byWeekday.get(weekday) ?? { meals: 0, minutes: 0, withTimes: 0 };
    bucket.meals += 1;
    const recipe = row.recipeId ? recipeMap.get(row.recipeId) : undefined;
    // prep + cook, counting a recipe that states only one of the two.
    const stated =
      (recipe?.prepTimeMinutes ?? 0) + (recipe?.cookTimeMinutes ?? 0);
    if (recipe && stated > 0) {
      bucket.minutes += stated;
      bucket.withTimes += 1;
    }
    byWeekday.set(weekday, bucket);
  }
  const weekdays: WeekdayCookTimeRow[] = WEEKDAY_NAMES.map((weekdayName, weekday) => {
    const bucket = byWeekday.get(weekday);
    return {
      weekday,
      weekdayName,
      meals: bucket?.meals ?? 0,
      withTimes: bucket?.withTimes ?? 0,
      // Null rather than 0 when nothing states a time: an average of no
      // measurements is not zero minutes, and showing 0 would read as "we
      // cook nothing on Fridays".
      averageMinutes:
        bucket && bucket.withTimes > 0
          ? Math.round(bucket.minutes / bucket.withTimes)
          : null,
    };
  });

  // --- Tag mix -------------------------------------------------------------
  const tagCounts = new Map<string, { name: string; count: number }>();
  let untaggedMeals = 0;
  for (const row of history) {
    if (row.tags.length === 0) {
      untaggedMeals += 1;
      continue;
    }
    for (const name of row.tags) {
      const key = tagKey(name);
      const existing = tagCounts.get(key);
      if (existing) existing.count += 1;
      else tagCounts.set(key, { name, count: 1 });
    }
  }
  const totalMeals = history.length;
  const tagMix: TagMixRow[] = [...tagCounts.values()]
    .map((t) => ({
      tag: t.name,
      count: t.count,
      // Share of MEALS, not of tags: a meal with three tags contributes to
      // three rows, so these deliberately do not sum to 100.
      percent: totalMeals > 0 ? Math.round((t.count / totalMeals) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

  // --- Desserts ------------------------------------------------------------
  const dessertMeals = history.filter((row) => {
    const recipe = row.recipeId ? recipeMap.get(row.recipeId) : undefined;
    return recipe ? isDessertRecipe(recipe) : false;
  }).length;

  // --- Who plans -----------------------------------------------------------
  const plannerCounts = new Map<string, number>();
  for (const row of history) {
    const name = row.plannedByName ?? "Unknown";
    plannerCounts.set(name, (plannerCounts.get(name) ?? 0) + 1);
  }
  const planners: PlannerRow[] = [...plannerCounts.entries()]
    .map(([userName, count]) => ({
      userName,
      count,
      percent: totalMeals > 0 ? Math.round((count / totalMeals) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count || a.userName.localeCompare(b.userName));

  return {
    spanStart,
    spanEnd,
    spanDays,
    totalMeals,
    coverage,
    weekdays,
    tagMix,
    untaggedMeals,
    dessertMeals,
    dessertsPerWeek:
      spanDays >= 7 ? Math.round((dessertMeals / spanDays) * 7 * 10) / 10 : null,
    planners,
  };
}
