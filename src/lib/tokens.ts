import { createHash, randomBytes } from "node:crypto";

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function tokenExpiryDate(hoursFromNow = 24): Date {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
}

/**
 * The form a token is stored in when the database copy must not be usable on
 * its own: a password-reset token lets whoever holds it take over the
 * account, so only its hash is kept, and the emailed original is what proves
 * possession. SHA-256 is enough — the token is 256 random bits, so there is
 * nothing to brute-force that a slow hash would slow down.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
