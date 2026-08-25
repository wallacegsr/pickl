import crypto from "node:crypto";

// Symmetric encryption for small secrets we need to store at rest (right
// now: the SMTP password in app_settings) and be able to recover in
// plaintext later (unlike passwords, which are one-way bcrypt hashes).

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV, the recommended size for GCM

// Derives a 32-byte key from NEXTAUTH_SECRET via SHA-256.
//
// We deliberately use a plain hash here rather than crypto.scryptSync
// (which would be the more "correct" choice for deriving a key from a
// low-entropy, user-chosen password). NEXTAUTH_SECRET is not that: it's
// already a high-entropy random secret required elsewhere in this app to
// sign session JWTs (see src/lib/auth.ts), so there's no weak-password
// brute-force scenario for scrypt's deliberate slowness/salting to defend
// against — a fast, deterministic hash is adequate and keeps this
// synchronous and simple (important since this can be called from
// synchronous better-sqlite3 read paths).
function getKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "NEXTAUTH_SECRET is not set (or too short) — cannot encrypt/decrypt stored secrets. " +
        "This should always be configured in this app (it's also required for session signing; see src/lib/auth.ts)."
    );
  }
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Encrypts `plaintext`, returning a single self-contained string:
 * `iv:authTag:ciphertext`, all hex-encoded. Round-trips with `decrypt`.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    ciphertext.toString("hex"),
  ].join(":");
}

/** Decrypts a string produced by `encrypt`. */
export function decrypt(stored: string): string {
  const key = getKey();
  const parts = stored.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted value format.");
  }
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
