import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { auditLog, type Scope } from "@/db/schema";

export type AuditAction =
  | "spin_today"
  | "spin_week"
  | "manual_set"
  | "manual_clear"
  | "recipe_create"
  | "recipe_update"
  | "recipe_delete"
  | "permission_change"
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

/** Records an audit_log row. Called from every plan-entry / recipe write path. */
export function logAuditEntry(input: LogAuditEntryInput) {
  db.insert(auditLog)
    .values({
      id: randomUUID(),
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
