import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

export class EmailNotVerifiedError extends CredentialsSignin {
  code = "EmailNotVerified";
}

export class InvalidCredentialsError extends CredentialsSignin {
  code = "InvalidCredentials";
}

export class AccountDeactivatedError extends CredentialsSignin {
  code = "AccountDeactivated";
}

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
      async authorize(credentials) {
        const email = String(credentials?.email || "")
          .trim()
          .toLowerCase();
        const password = String(credentials?.password || "");

        if (!email || !password) throw new InvalidCredentialsError();

        const user = db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .get();

        if (!user) throw new InvalidCredentialsError();

        const passwordMatches = await bcrypt.compare(
          password,
          user.passwordHash
        );
        if (!passwordMatches) throw new InvalidCredentialsError();

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
        if (fresh) {
          token.role = fresh.role;
          token.canAccessSharedCalendar = fresh.canAccessSharedCalendar;
          // Re-read too, so moving a user between households (or revoking
          // platform access) takes effect without a fresh login — the same
          // reason the role is refreshed here.
          token.householdId = fresh.householdId ?? null;
          token.isGlobalAdmin = fresh.isGlobalAdmin;
        }
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
