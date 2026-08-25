import type { SessionUser } from "@/lib/permissions";
import {
  canAccessPrivateCalendar,
  canEditSharedCalendar,
  canViewSharedCalendar,
} from "@/lib/permissions";
import type { Scope } from "@/db/schema";

export interface PlanContext {
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
 * Resolves & authorizes {scope, userId} for a plan read/write, given the
 * requested scope and (for private) an optional targetUserId (only an
 * admin may pass a targetUserId other than themselves).
 */
export function resolvePlanContext(
  user: SessionUser | null | undefined,
  scopeRaw: string | null | undefined,
  targetUserId: string | null | undefined,
  mode: "read" | "write"
): ResolveResult | ResolveError {
  if (!user) return { ok: false, status: 401, error: "Unauthorized" };

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
    return { ok: true, context: { scope, userId: "" } };
  }

  const resolvedTarget = targetUserId || user.id;
  if (!canAccessPrivateCalendar(user, resolvedTarget)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: true, context: { scope, userId: resolvedTarget } };
}
