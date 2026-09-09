import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      canAccessSharedCalendar: boolean;
      /**
       * The household this user belongs to, or null for a platform operator
       * who administers the deployment without being part of a family.
       *
       * Every household-scoped query filters on this, so a null here means the
       * session can reach no household content at all.
       */
      householdId: string | null;
      /**
       * Platform operator. Grants the household-management and deployment
       * settings screens — NOT access to any household's contents, which is
       * governed by householdId above.
       */
      isGlobalAdmin: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
    canAccessSharedCalendar?: boolean;
    householdId?: string | null;
    isGlobalAdmin?: boolean;
  }
}
