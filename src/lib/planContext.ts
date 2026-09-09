import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import type { SessionUser } from "@/lib/permissions";
import {
  canAccessPrivateCalendar,
  canEditSharedCalendar,
  canViewSharedCalendar,
  householdScope,
} from "@/lib/permissions";
import type { Scope } from "@/db/schema";
import { suspensionError } from "@/lib/households";

export interface PlanContext {
  /**
   * Whose data this operation may touch. Resolved here, once, so that no route
   * has to remember to look it up — and so that a session with no household
   * (a platform operator) is turned away before it reaches a query.
   */
  householdId: string;
  scope: Scope;
  userId: string; // owner of the calendar being acted on
}

export interface ResolveResult {
  ok: true;
  context: PlanContext;
}
export interface ResolveError {
  ok: false;
  status: number;
  error: string;
}

/**
 * Resolves & authorizes {householdId, scope, userId} for a plan read/write,
 * given the requested scope and (for private) an optional targetUserId (only an
 * admin may pass a targetUserId other than themselves).
 */
export function resolvePlanContext(
  user: SessionUser | null | undefined,
  scopeRaw: string | null | undefined,
  targetUserId: string | null | undefined,
  mode: "read" | "write"
): ResolveResult | ResolveError {
  if (!user) return { ok: false, status: 401, error: "Unauthorized" };

  const householdId = householdScope(user);
  // A platform operator belongs to no household, so there is no calendar for
  // them to read or write. They administer households; they are not in one.
  if (!householdId) {
    return { ok: false, status: 403, error: "This account is not part of a household." };
  }

  // A suspended household is readable but frozen. Checked here rather than in
  // each route so no write path can be added later that forgets it.
  if (mode === "write") {
    const suspended = suspensionError(householdId);
    if (suspended) return { ok: false, ...suspended };
  }

  const scope: Scope = scopeRaw === "private" ? "private" : "shared";

  if (scope === "shared") {
    if (mode === "read" && !canViewSharedCalendar(user)) {
      return { ok: false, status: 403, error: "Forbidden" };
    }
    if (mode === "write" && !canEditSharedCalendar(user)) {
      return {
        ok: false,
        status: 403,
        error: "You do not have permission to edit the household calendar.",
      };
    }
    return { ok: true, context: { householdId, scope, userId: "" } };
  }

  const resolvedTarget = targetUserId || user.id;
  if (!canAccessPrivateCalendar(user, resolvedTarget)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  // canAccessPrivateCalendar says yes to any household admin, which was the
  // whole story when there was one household. It isn't now: without this, an
  // admin could pass another family's user id and read their private calendar.
  // Checked by membership rather than by role, so it holds for the self case
  // too if a user is ever moved between households mid-session.
  if (resolvedTarget !== user.id) {
    const target = db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, resolvedTarget), eq(users.householdId, householdId)))
      .get();
    if (!target) return { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: true, context: { householdId, scope, userId: resolvedTarget } };
}
