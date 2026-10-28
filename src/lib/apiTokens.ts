import { randomBytes, randomUUID } from "node:crypto";
import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { apiTokens, households, users, type ApiTokenScope } from "@/db/schema";
import type { SessionUser } from "@/lib/permissions";
import { hashToken } from "@/lib/tokens";

/**
 * Personal API tokens: creation, listing, revocation, and turning a presented
 * token back into the user it acts for.
 *
 * The token itself is shown once, at creation, and only its hash is stored.
 * The `pkl_` prefix lets secret scanners (GitHub's among them) recognise one
 * pasted somewhere it should not be.
 */

export const TOKEN_PREFIX = "pkl_";

/** Enough for every device and integration a person could want, and no more. */
export const MAX_TOKENS_PER_USER = 20;

export interface ApiTokenSummary {
  id: string;
  name: string;
  scope: ApiTokenScope;
  hint: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

function summarize(row: typeof apiTokens.$inferSelect): ApiTokenSummary {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope as ApiTokenScope,
    hint: row.hint,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  };
}

/** Whether this household lets its members use API tokens at all. */
export function householdAllowsApi(householdId: string): boolean {
  const row = db
    .select({ apiAccess: households.apiAccess })
    .from(households)
    .where(eq(households.id, householdId))
    .get();
  return Boolean(row?.apiAccess);
}

export function listApiTokens(userId: string): ApiTokenSummary[] {
  return db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(desc(apiTokens.createdAt))
    .all()
    .map(summarize);
}

export type CreateTokenResult =
  | { ok: true; token: string; summary: ApiTokenSummary }
  | { ok: false; status: number; error: string };

export function createApiToken(input: {
  userId: string;
  householdId: string;
  name: string;
  scope: ApiTokenScope;
  expiresInDays: number | null;
}): CreateTokenResult {
  if (!householdAllowsApi(input.householdId)) {
    return {
      ok: false,
      status: 403,
      error: "API access is turned off for this household. A household admin can turn it on.",
    };
  }
  const existing = db
    .select({ n: count() })
    .from(apiTokens)
    .where(eq(apiTokens.userId, input.userId))
    .get();
  if ((existing?.n ?? 0) >= MAX_TOKENS_PER_USER) {
    return {
      ok: false,
      status: 400,
      error: `You already have ${MAX_TOKENS_PER_USER} tokens. Revoke one you no longer use first.`,
    };
  }

  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const row = {
    id: randomUUID(),
    householdId: input.householdId,
    userId: input.userId,
    name: input.name,
    tokenHash: hashToken(token),
    hint: token.slice(-4),
    scope: input.scope,
    createdAt: new Date(),
    lastUsedAt: null,
    expiresAt: input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null,
  };
  db.insert(apiTokens).values(row).run();
  return { ok: true, token, summary: summarize(row) };
}

/** Deletes one of the caller's own tokens. Another person's id matches nothing. */
export function revokeApiToken(userId: string, tokenId: string): ApiTokenSummary | null {
  const row = db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId)))
    .get();
  if (!row) return null;
  db.delete(apiTokens).where(eq(apiTokens.id, row.id)).run();
  return summarize(row);
}

export interface ApiPrincipal {
  /** Shaped exactly like a browser session's user, so every permission check applies unchanged. */
  user: SessionUser;
  householdId: string;
  token: { id: string; name: string; scope: ApiTokenScope };
}

export type AuthenticateResult =
  | { ok: true; principal: ApiPrincipal }
  | { ok: false; status: 401 | 403; error: string };

/** How stale `lastUsedAt` may get before a request bothers to write it again. */
const LAST_USED_RESOLUTION_MS = 60 * 1000;

/**
 * The user a presented token acts for, checked afresh on every request: a
 * revoked or expired token, a deactivated account, a user who has moved
 * household, or a household that has turned API access off all end it at once,
 * the same way the session callback in src/lib/auth.ts ends a browser session.
 */
export function authenticateApiToken(raw: string | null | undefined): AuthenticateResult {
  const unauthorized = { ok: false as const, status: 401 as const, error: "Invalid or expired API token." };
  if (!raw || !raw.startsWith(TOKEN_PREFIX) || raw.length > 200) return unauthorized;

  const row = db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hashToken(raw))).get();
  if (!row) return unauthorized;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return unauthorized;

  const user = db.select().from(users).where(eq(users.id, row.userId)).get();
  // A token is issued within one household. If its owner has since moved, it
  // must not quietly start reading the new household's plan.
  if (!user || !user.active || user.householdId !== row.householdId) return unauthorized;

  if (!householdAllowsApi(row.householdId)) {
    return { ok: false, status: 403, error: "API access is turned off for this household." };
  }

  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
    db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.id)).run();
  }

  return {
    ok: true,
    principal: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        canAccessSharedCalendar: user.canAccessSharedCalendar,
        householdId: user.householdId,
        isGlobalAdmin: user.isGlobalAdmin,
      },
      householdId: row.householdId,
      token: { id: row.id, name: row.name, scope: row.scope as ApiTokenScope },
    },
  };
}
