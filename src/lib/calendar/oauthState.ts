import crypto from "node:crypto";
import { and, eq, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { oauthStates } from "@/db/schema";

/**
 * OAuth `state` minting and redemption.
 *
 * This is the security-critical half of the connect flow. Without a state
 * check bound to the initiating session, anyone could hand a victim a
 * crafted callback URL and attach an *attacker-controlled* Google account
 * to the victim's Pickl user (or, in the other direction, attach
 * the victim's Google account to the attacker's user). So the rules are:
 *
 *  - cryptographically random (32 bytes, base64url — not guessable);
 *  - bound to the user id that started the flow;
 *  - stored server-side, so "already used" is a database fact rather than
 *    something we hope the browser honoured;
 *  - single-use: redemption stamps `usedAt`, and a second attempt fails;
 *  - short-lived (10 minutes).
 *
 * `consumeState` returns a discriminated result rather than throwing, so
 * the callback route can map each distinct failure to a friendly redirect
 * without a stack trace ever reaching the user.
 */

const STATE_TTL_MS = 10 * 60 * 1000;

export function mintState(userId: string, provider = "google"): string {
  purgeExpiredStates();
  const state = crypto.randomBytes(32).toString("base64url");
  db.insert(oauthStates)
    .values({
      state,
      userId,
      provider,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
      usedAt: null,
    })
    .run();
  return state;
}

export type ConsumeStateResult =
  | { ok: true; userId: string }
  | {
      ok: false;
      reason: "missing" | "unknown" | "expired" | "used" | "wrong_user";
    };

/**
 * Validates and atomically consumes a state.
 *
 * `sessionUserId` is the user the CURRENT browser session is logged in as
 * — never a user id from the request. A state minted for user A can never
 * be redeemed by a session for user B.
 */
export function consumeState(
  state: string | null | undefined,
  sessionUserId: string,
  provider = "google"
): ConsumeStateResult {
  if (!state) return { ok: false, reason: "missing" };

  const row = db
    .select()
    .from(oauthStates)
    .where(
      and(eq(oauthStates.state, state), eq(oauthStates.provider, provider))
    )
    .get();

  if (!row) return { ok: false, reason: "unknown" };

  // Order matters only for the error message; every branch below rejects.
  if (row.usedAt) {
    return { ok: false, reason: "used" };
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    deleteState(state);
    return { ok: false, reason: "expired" };
  }
  if (row.userId !== sessionUserId) {
    // Burn it: a state redeemed against the wrong session is either an
    // attack or a badly confused browser, and either way it must not stay
    // redeemable.
    markUsed(state);
    return { ok: false, reason: "wrong_user" };
  }

  // Single-use: stamp BEFORE doing anything with the authorization code,
  // so a replay of the same callback URL cannot be redeemed twice.
  const changes = markUsed(state);
  if (changes === 0) return { ok: false, reason: "used" };

  return { ok: true, userId: row.userId };
}

/**
 * Stamps `usedAt`, but only if it is still NULL. The `IS NULL` guard is
 * what makes redemption atomic: two concurrent callbacks carrying the same
 * state race on this single UPDATE and exactly one sees changes === 1.
 */
function markUsed(state: string): number {
  const result = db
    .update(oauthStates)
    .set({ usedAt: new Date() })
    .where(and(eq(oauthStates.state, state), isNull(oauthStates.usedAt)))
    .run();
  return Number((result as { changes?: number }).changes ?? 0);
}

function deleteState(state: string) {
  db.delete(oauthStates).where(eq(oauthStates.state, state)).run();
}

/** Housekeeping: drop states that can no longer be redeemed. */
export function purgeExpiredStates() {
  db.delete(oauthStates)
    .where(lt(oauthStates.expiresAt, new Date(Date.now() - STATE_TTL_MS)))
    .run();
}
