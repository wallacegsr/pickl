import { and, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, planEntries, recipes, users, type MealType, type Scope } from "@/db/schema";
import { isAdmin, type SessionUser } from "@/lib/permissions";

export interface ReportFilters {
  startDate?: string;
  endDate?: string;
  scope?: Scope;
  mealType?: MealType;
  userId?: string; // admin-only: restrict to one user's private data
}

export interface MealHistoryRow {
  date: string;
  mealType: string;
  scope: string;
  recipeId: string | null;
  recipeName: string | null;
  plannedByName: string | null;
  ownerName: string | null; // whose calendar (private only)
}

function loadLookups() {
  const allRecipes = db.select().from(recipes).all();
  const allUsers = db.select().from(users).all();
  const recipeMap = new Map(allRecipes.map((r) => [r.id, r]));
  const userMap = new Map(allUsers.map((u) => [u.id, u]));
  return { recipeMap, userMap };
}

function dateRangeConditions(filters: ReportFilters) {
  const conditions = [];
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
  const conditions = dateRangeConditions(filters);
  const rows = db
    .select()
    .from(planEntries)
    .where(conditions.length ? and(...conditions) : undefined)
    .all();

  const { recipeMap, userMap } = loadLookups();

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
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.mealType.localeCompare(b.mealType));
}

export interface RecipeFrequencyRow {
  recipeId: string;
  recipeName: string;
  scope: string; // 'shared' | 'private' | 'mixed'
  count: number;
}

export function getRecipeFrequency(
  requestingUser: SessionUser,
  filters: ReportFilters
): RecipeFrequencyRow[] {
  const history = getMealHistory(requestingUser, filters);
  const counts = new Map<string, { name: string; scopes: Set<string>; count: number }>();

  for (const row of history) {
    if (!row.recipeId || !row.recipeName) continue;
    const existing = counts.get(row.recipeId);
    if (existing) {
      existing.count += 1;
      existing.scopes.add(row.scope);
    } else {
      counts.set(row.recipeId, {
        name: row.recipeName,
        scopes: new Set([row.scope]),
        count: 1,
      });
    }
  }

  return Array.from(counts.entries())
    .map(([recipeId, v]) => ({
      recipeId,
      recipeName: v.name,
      scope: v.scopes.size > 1 ? "mixed" : Array.from(v.scopes)[0],
      count: v.count,
    }))
    .sort((a, b) => b.count - a.count);
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
  action?: string;
  userId?: string; // admin-only: restrict to actions by/about one user
}

export function getAuditLogReport(
  requestingUser: SessionUser,
  filters: AuditLogFilters
): AuditLogRow[] {
  const conditions = [];
  if (filters.startDate) conditions.push(gte(auditLog.date, filters.startDate));
  if (filters.endDate) conditions.push(lte(auditLog.date, filters.endDate));

  const rows = db
    .select()
    .from(auditLog)
    .where(conditions.length ? and(...conditions) : undefined)
    .all();

  const { recipeMap, userMap } = loadLookups();

  return rows
    .filter((r) => {
      if (isAdmin(requestingUser)) return true;
      return r.userId === requestingUser.id || r.targetUserId === requestingUser.id;
    })
    .filter((r) => (filters.action ? r.action === filters.action : true))
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
