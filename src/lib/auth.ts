import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { clear, clientIp, hit, isLimited } from "@/lib/rateLimit";

export class EmailNotVerifiedError extends CredentialsSignin {
  code = "EmailNotVerified";
}

export class InvalidCredentialsError extends CredentialsSignin {
  code = "InvalidCredentials";
}

export class AccountDeactivatedError extends CredentialsSignin {
  code = "AccountDeactivated";
}

export class TooManyAttemptsError extends CredentialsSignin {
  code = "TooManyAttempts";
}

/** Failed logins allowed per email address, and per client address, per window. */
const LOGIN_FAILURES_PER_EMAIL = 8;
const LOGIN_FAILURES_PER_IP = 30;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/**
 * Compared against when the email has no account, so a wrong address takes as
 * long as a wrong password. Without it, the fast "no such user" path tells
 * anyone timing the response which addresses are registered.
 */
const DUMMY_HASH = bcrypt.hashSync("pickl-timing-equaliser", 10);

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const email = String(credentials?.email || "")
          .trim()
          .toLowerCase();
        const password = String(credentials?.password || "");

        if (!email || !password) throw new InvalidCredentialsError();

        // Only failures count, so a person who types their password right is
        // never slowed by someone else guessing at their address.
        const ip = request ? clientIp(request.headers) : "unknown";
        const emailKey = `login:email:${email}`;
        const ipKey = `login:ip:${ip}`;
        if (isLimited(emailKey, LOGIN_FAILURES_PER_EMAIL) || isLimited(ipKey, LOGIN_FAILURES_PER_IP)) {
          throw new TooManyAttemptsError();
        }
        const fail = () => {
          hit(emailKey, LOGIN_FAILURES_PER_EMAIL, LOGIN_WINDOW_MS);
          hit(ipKey, LOGIN_FAILURES_PER_IP, LOGIN_WINDOW_MS);
          return new InvalidCredentialsError();
        };

        const user = db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .get();

        const passwordMatches = await bcrypt.compare(
          password,
          user?.passwordHash ?? DUMMY_HASH
        );
        if (!user || !passwordMatches) throw fail();
        clear(emailKey);

        if (!user.emailVerified) {
          throw new EmailNotVerifiedError();
        }

        if (!user.active) {
          throw new AccountDeactivatedError();
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          active: user.active,
          canAccessSharedCalendar: user.canAccessSharedCalendar,
          householdId: user.householdId,
          isGlobalAdmin: user.isGlobalAdmin,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role?: string }).role ?? "member";
        token.canAccessSharedCalendar = Boolean(
          (user as { canAccessSharedCalendar?: boolean }).canAccessSharedCalendar
        );
        token.householdId =
          (user as { householdId?: string | null }).householdId ?? null;
        token.isGlobalAdmin = Boolean(
          (user as { isGlobalAdmin?: boolean }).isGlobalAdmin
        );
      }
      // Re-read from the DB on every session check so admin changes to a
      // user's role/permissions take effect without forcing a fresh login.
      if (token.id) {
        const fresh = db
          .select()
          .from(users)
          .where(eq(users.id, token.id as string))
          .get();
        // A deleted or deactivated account ends its session here, on its next
        // request, rather than when the JWT eventually expires. Login already
        // refused them; without this a session opened before the change kept
        // working for up to 30 days. Returning null signs the cookie out.
        if (!fresh || !fresh.active) return null;
        // A session older than the current password ends too: resetting or
        // changing a password signs out every other device. `iat` is absent
        // only while a session is being created, and is in whole seconds, as
        // is passwordChangedAt — so a login in the same second still counts.
        if (
          fresh.passwordChangedAt &&
          typeof token.iat === "number" &&
          token.iat * 1000 < fresh.passwordChangedAt.getTime()
        ) {
          return null;
        }
        token.role = fresh.role;
        token.canAccessSharedCalendar = fresh.canAccessSharedCalendar;
        // Re-read too, so moving a user between households (or revoking
        // platform access) takes effect without a fresh login — the same
        // reason the role is refreshed here.
        token.householdId = fresh.householdId ?? null;
        token.isGlobalAdmin = fresh.isGlobalAdmin;
      }
      void trigger;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
        session.user.role = (token.role as string) ?? "member";
        session.user.canAccessSharedCalendar = Boolean(
          token.canAccessSharedCalendar
        );
        session.user.householdId = (token.householdId as string | null) ?? null;
        session.user.isGlobalAdmin = Boolean(token.isGlobalAdmin);
      }
      return session;
    },
  },
});
