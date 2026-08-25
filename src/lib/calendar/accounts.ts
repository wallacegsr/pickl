import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  calendarAccounts,
  calendarEventLinks,
  calendarTargets,
  type CalendarAccount,
  type CalendarTarget,
  type Scope,
} from "@/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";

/**
 * Per-user calendar account + sync target storage.
 *
 * **Every function here is scoped by owner.** No lookup returns another
 * user's account or target, and there is no admin override: an admin has
 * exactly the same (zero) access to a member's calendar connection as any
 * member does. The userId always comes from the server-side session at the
 * route boundary, never from the request body.
 *
 * `getAccountById` takes the expected owner too, so even the internal sync
 * path cannot resolve an account across users.
 */

export function getAccountForUser(
  userId: string,
  provider = "google"
): CalendarAccount | undefined {
  return db
    .select()
    .from(calendarAccounts)
    .where(
      and(
        eq(calendarAccounts.userId, userId),
        eq(calendarAccounts.provider, provider)
      )
    )
    .get();
}

export function getTargetsForUser(userId: string): CalendarTarget[] {
  return db
    .select()
    .from(calendarTargets)
    .where(eq(calendarTargets.userId, userId))
    .all();
}

/**
 * One target, looked up by id AND owner. The userId in the WHERE clause is
 * the authorization check — a target id belonging to someone else simply
 * does not resolve.
 */
export function getOwnedTarget(
  userId: string,
  targetId: string
): CalendarTarget | undefined {
  return db
    .select()
    .from(calendarTargets)
    .where(
      and(eq(calendarTargets.id, targetId), eq(calendarTargets.userId, userId))
    )
    .get();
}

export function getTargetForUserScope(
  userId: string,
  scope: Scope
): CalendarTarget | undefined {
  return db
    .select()
    .from(calendarTargets)
    .where(
      and(eq(calendarTargets.userId, userId), eq(calendarTargets.scope, scope))
    )
    .get();
}

/** Every enabled 'shared'-scope target across all users — the fan-out list. */
export function getEnabledSharedTargets(): CalendarTarget[] {
  return db
    .select()
    .from(calendarTargets)
    .where(
      and(
        eq(calendarTargets.scope, "shared"),
        eq(calendarTargets.enabled, true)
      )
    )
    .all();
}

export function getAccountById(
  accountId: string,
  expectedUserId: string
): CalendarAccount | undefined {
  // Called by the sync layer with the owning target's userId. Requiring the
  // expected owner keeps the "no cross-user lookup" rule an enforced
  // invariant rather than a convention the caller has to remember — and it
  // turns an inconsistent target -> account pairing (which would otherwise
  // push one household member's meals into another's calendar) into a
  // no-op instead of a privacy breach.
  const account = db
    .select()
    .from(calendarAccounts)
    .where(
      and(
        eq(calendarAccounts.id, accountId),
        eq(calendarAccounts.userId, expectedUserId)
      )
    )
    .get();
  return account;
}

/**
 * Stores (or replaces) the user's Google authorization. The refresh token
 * is encrypted with the same AES-256-GCM helper as the SMTP password; the
 * plaintext never touches the database.
 */
export function upsertAccount(input: {
  userId: string;
  provider?: string;
  refreshToken: string;
  accountEmail: string | null;
  scopes: string;
}): CalendarAccount {
  const provider = input.provider ?? "google";
  const existing = getAccountForUser(input.userId, provider);
  const now = new Date();

  if (existing) {
    db.update(calendarAccounts)
      .set({
        refreshTokenEncrypted: encrypt(input.refreshToken),
        accountEmail: input.accountEmail,
        scopes: input.scopes,
        // A successful reconnect clears any "reconnect needed" banner.
        lastError: null,
        updatedAt: now,
      })
      .where(eq(calendarAccounts.id, existing.id))
      .run();
    return getAccountForUser(input.userId, provider)!;
  }

  db.insert(calendarAccounts)
    .values({
      id: randomUUID(),
      userId: input.userId,
      provider,
      refreshTokenEncrypted: encrypt(input.refreshToken),
      accountEmail: input.accountEmail,
      scopes: input.scopes,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return getAccountForUser(input.userId, provider)!;
}

/**
 * Stores (or replaces) the user's CalDAV connection.
 *
 * `password` is optional on update: omitting it means "keep the password
 * already on file", the same convention the SMTP settings use, so the
 * plaintext never has to make a round trip to the browser and back just
 * to change a URL.
 *
 * The caller is expected to have validated and discovery-tested the URL
 * first (see /api/calendar/caldav/connect) — we do not store credentials
 * that have never been shown to work.
 */
export function upsertCaldavAccount(input: {
  userId: string;
  serverUrl: string;
  username: string;
  password?: string | null;
  homeUrl: string | null;
}): CalendarAccount {
  const existing = getAccountForUser(input.userId, "caldav");
  const now = new Date();

  if (existing) {
    db.update(calendarAccounts)
      .set({
        caldavServerUrl: input.serverUrl,
        caldavUsername: input.username,
        ...(input.password
          ? { caldavPasswordEncrypted: encrypt(input.password) }
          : {}),
        caldavHomeUrl: input.homeUrl,
        // The label the UI shows for a CalDAV connection is the username.
        accountEmail: input.username,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(calendarAccounts.id, existing.id))
      .run();
    return getAccountForUser(input.userId, "caldav")!;
  }

  if (!input.password) {
    throw new Error("A password is required to connect a CalDAV server.");
  }

  db.insert(calendarAccounts)
    .values({
      id: randomUUID(),
      userId: input.userId,
      provider: "caldav",
      caldavServerUrl: input.serverUrl,
      caldavUsername: input.username,
      caldavPasswordEncrypted: encrypt(input.password),
      caldavHomeUrl: input.homeUrl,
      accountEmail: input.username,
      scopes: "",
      lastError: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return getAccountForUser(input.userId, "caldav")!;
}

/**
 * Decrypts one account's CalDAV credentials for a single outbound
 * request. Deliberately the ONLY place the password is decrypted, and it
 * is never returned through an API route — /api/calendar/** exposes a
 * `hasPassword` boolean and nothing more.
 */
export function getCaldavCredentials(account: CalendarAccount): {
  serverUrl: string;
  username: string;
  password: string;
} {
  if (
    !account.caldavServerUrl ||
    !account.caldavUsername ||
    !account.caldavPasswordEncrypted
  ) {
    throw new Error(
      "This CalDAV connection is missing its server details. Reconnect it under Preferences → Calendars."
    );
  }
  return {
    serverUrl: account.caldavServerUrl,
    username: account.caldavUsername,
    password: decrypt(account.caldavPasswordEncrypted),
  };
}

/**
 * Whether an account still holds the credential its provider needs. Used
 * by the sync layer to skip a half-configured connection quietly instead
 * of throwing a confusing error on every push.
 */
export function accountHasCredentials(account: CalendarAccount): boolean {
  return account.provider === "caldav"
    ? Boolean(
        account.caldavServerUrl &&
          account.caldavUsername &&
          account.caldavPasswordEncrypted
      )
    : Boolean(account.refreshTokenEncrypted);
}

export function setAccountError(accountId: string, message: string | null) {
  db.update(calendarAccounts)
    .set({ lastError: message ? message.slice(0, 1000) : null, updatedAt: new Date() })
    .where(eq(calendarAccounts.id, accountId))
    .run();
}

/**
 * Creates or updates the user's target for one plan.
 * UNIQUE(userId, scope) means there is at most one per plan per user.
 */
export function upsertTarget(input: {
  userId: string;
  accountId: string;
  scope: Scope;
  calendarId: string;
  calendarName: string | null;
  includeDetail: boolean;
  enabled: boolean;
}): CalendarTarget {
  const existing = getTargetForUserScope(input.userId, input.scope);
  const now = new Date();

  if (existing) {
    // Switching to a different remote calendar invalidates every event id
    // we recorded against the old one — drop the links so the next push
    // creates fresh events instead of trying to PUT ids the new calendar
    // has never heard of.
    if (existing.calendarId !== input.calendarId) {
      deleteEventLinksForTarget(existing.id);
    }
    db.update(calendarTargets)
      .set({
        accountId: input.accountId,
        calendarId: input.calendarId,
        calendarName: input.calendarName,
        includeDetail: input.includeDetail,
        enabled: input.enabled,
        lastSyncError: null,
        updatedAt: now,
      })
      .where(eq(calendarTargets.id, existing.id))
      .run();
    return getTargetForUserScope(input.userId, input.scope)!;
  }

  db.insert(calendarTargets)
    .values({
      id: randomUUID(),
      accountId: input.accountId,
      userId: input.userId,
      scope: input.scope,
      calendarId: input.calendarId,
      calendarName: input.calendarName,
      includeDetail: input.includeDetail,
      enabled: input.enabled,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return getTargetForUserScope(input.userId, input.scope)!;
}

export function deleteEventLinksForTarget(targetId: string) {
  db.delete(calendarEventLinks)
    .where(eq(calendarEventLinks.targetId, targetId))
    .run();
}

/**
 * Removes one plan's target ("Don't sync"). Local only — already-pushed
 * events stay in the user's Google Calendar, which the UI says explicitly.
 * Silently deleting a week of someone's calendar entries would be a far
 * more surprising outcome than leaving them behind.
 */
export function deleteTargetForScope(userId: string, scope: Scope): boolean {
  const existing = getTargetForUserScope(userId, scope);
  if (!existing) return false;
  // The FK is ON DELETE CASCADE, but foreign_keys is a per-connection
  // pragma — delete the links explicitly so this is correct regardless.
  deleteEventLinksForTarget(existing.id);
  db.delete(calendarTargets).where(eq(calendarTargets.id, existing.id)).run();
  return true;
}

/**
 * Deletes one of the user's provider accounts, the targets that point at
 * it, and those targets' event links.
 *
 * Scoped to the account, not the user: now that a user can hold a Google
 * *and* a CalDAV connection at once, disconnecting one must not quietly
 * tear down the other's sync targets.
 */
export function deleteAccountForUser(userId: string, provider = "google") {
  const account = getAccountForUser(userId, provider);
  if (!account) return;
  const owned = getTargetsForUser(userId).filter(
    (target) => target.accountId === account.id
  );
  for (const target of owned) {
    deleteEventLinksForTarget(target.id);
    db.delete(calendarTargets).where(eq(calendarTargets.id, target.id)).run();
  }
  db.delete(calendarAccounts).where(eq(calendarAccounts.id, account.id)).run();
}
