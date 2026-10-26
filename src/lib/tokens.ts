import { createHash, randomBytes } from "node:crypto";

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function tokenExpiryDate(hoursFromNow = 24): Date {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
}

/**
 * The form every emailed token is stored in, so the database copy is not usable
 * on its own: a reset or invite token sets an account's password, a
 * verification or email-change token vouches for an address. Only the hash is
 * kept, and the emailed original is what proves possession. SHA-256 is enough — the token is 256 random bits, so there is
 * nothing to brute-force that a slow hash would slow down.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
