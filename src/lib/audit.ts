import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, users, type Scope } from "@/db/schema";

export type AuditAction =
  | "spin_today"
  | "spin_week"
  | "manual_set"
  | "manual_clear"
  | "recipe_create"
  | "recipe_update"
  | "recipe_delete"
  | "permission_change"
  // Tag vocabulary changes made from /tags. A tag edit only ever touches
  // recipes the actor may already edit, so `notes` records how many recipes
  // actually changed and how many were left alone by the permission rule.
  | "tag_create"
  | "tag_rename"
  | "tag_merge"
  | "tag_delete"
  // Per-user calendar connection lifecycle. `userId` and `targetUserId`
  // are always the same person — these are self-service actions, and no
  // admin has any path to another user's calendar connection. `notes`
  // carries only non-secret context (provider, calendar id, outcome) —
  // never tokens, never event contents.
  | "calendar_connect"
  | "calendar_update"
  | "calendar_disconnect"
  | "calendar_resync"
  // Admin-level OAuth *client* configuration (deployment plumbing, same
  // category as SMTP settings). `notes` never carries the client secret.
  | "calendar_oauth_config"
  // Household lifecycle. A rename can come from either admin; the rest are the
  // platform operator's, and their rows carry no household (the operator has
  // none), so they appear in no household's log — deliberately. What an
  // operator does to a household is deployment history, not family history.
  | "household_create"
  | "household_rename"
  | "household_suspend"
  | "household_delete"
  // Self-service preference changes (/preferences). `userId` and
  // `targetUserId` are always the same user — these are never admin actions.
  // `notes` carries only non-secret context: never a password, never a
  // pending-email token.
  | "profile_update"
  | "email_change_request"
  | "email_change_confirm"
  | "email_change_cancel"
  | "password_change"
  | "theme_change";

export interface LogAuditEntryInput {
  userId: string;
  action: AuditAction;
  scope?: Scope | null;
  targetUserId?: string | null;
  date?: string | null;
  mealType?: string | null;
  oldRecipeId?: string | null;
  newRecipeId?: string | null;
  notes?: string | null;
}

/**
 * Records an audit_log row. Called from every plan-entry / recipe write path.
 *
 * The household is looked up from the acting user rather than passed in.
 * There is no path by which a user writes an audit row about another
 * household — that is the point of the scoping everywhere else — so deriving
 * it here is both always right and impossible for a caller to get wrong,
 * which is worth one indexed lookup on a write path.
 *
 * Null for a platform operator: deployment-level actions (SMTP, the OAuth
 * client) belong to no household, and no household's audit log should list
 * them.
 */
export function logAuditEntry(input: LogAuditEntryInput) {
  const actor = db
    .select({ householdId: users.householdId })
    .from(users)
    .where(eq(users.id, input.userId))
    .get();

  db.insert(auditLog)
    .values({
      id: randomUUID(),
      householdId: actor?.householdId ?? null,
      userId: input.userId,
      action: input.action,
      scope: input.scope ?? null,
      targetUserId: input.targetUserId ?? null,
      date: input.date ?? null,
      mealType: input.mealType ?? null,
      oldRecipeId: input.oldRecipeId ?? null,
      newRecipeId: input.newRecipeId ?? null,
      notes: input.notes ?? null,
    })
    .run();
}
