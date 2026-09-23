import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type User } from "@/db/schema";
import { hashToken } from "@/lib/tokens";

export type ResetLookup = { ok: true; user: User } | { ok: false; error: string };

/**
 * The account a reset link belongs to, if the link is still good. Shared by
 * the reset page (to show the form or explain why not) and the API (to act),
 * so they cannot disagree about which links work.
 */
export function findResetUser(token: string | null | undefined): ResetLookup {
  if (!token) return { ok: false, error: "That reset link is incomplete." };
  const user = db.select().from(users).where(eq(users.resetTokenHash, hashToken(token))).get();
  if (!user) {
    return { ok: false, error: "That reset link isn't valid — it may already have been used." };
  }
  if (!user.resetTokenExpires || user.resetTokenExpires.getTime() < Date.now()) {
    return { ok: false, error: "That reset link has expired. Ask for a new one." };
  }
  if (!user.active) {
    return { ok: false, error: "This account has been deactivated. Contact an administrator." };
  }
  return { ok: true, user };
}
