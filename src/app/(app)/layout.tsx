import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import Providers from "@/components/Providers";
import AppShell from "@/components/nav/AppShell";
import ThemeSync from "@/components/ThemeSync";
import TimeZoneSync from "@/components/TimeZoneSync";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  // The saved theme preference, so ThemeSync can reconcile it against this
  // browser's localStorage after the no-flash paint.
  const themePreference =
    db
      .select({ themePreference: users.themePreference })
      .from(users)
      .where(eq(users.id, session.user.id))
      .get()?.themePreference ?? "system";

  return (
    <Providers>
      {/* Before AppShell, so the sidebar state it restores is in place when
          the sidebar reads it. */}
      <TimeZoneSync />
      <ThemeSync userId={session.user.id} savedPreference={themePreference} />
      <AppShell>{children}</AppShell>
    </Providers>
  );
}
