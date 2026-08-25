import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { auth } from "@/lib/auth";
import SettingsLayout from "@/components/SettingsLayout";
import ProfileSettingsPanel from "@/components/ProfileSettingsPanel";
import PasswordSettingsPanel from "@/components/PasswordSettingsPanel";
import AppearanceSettingsPanel from "@/components/AppearanceSettingsPanel";
import CalendarSettingsPanel from "@/components/CalendarSettingsPanel";
import { buildCalendarPanelState } from "@/lib/calendar/panelState";

/**
 * Per-user settings. Available to every signed-in user — deliberately NOT
 * admin-gated, and deliberately self-service only: every panel here acts on
 * the caller's own record, enforced server-side in /api/preferences/*.
 */
export default async function PreferencesPage({
  searchParams,
}: {
  searchParams: {
    error?: string;
    /** Set by the Google OAuth connect/callback routes. */
    calendarMessage?: string;
    calendarError?: string;
  };
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const user = db.select().from(users).where(eq(users.id, session.user.id)).get();
  if (!user) {
    redirect("/login");
  }

  // The caller's OWN calendar connection. Loaded with the session user id
  // and nothing else — there is no admin variant of this view anywhere.
  // Note what is absent: no refresh token, encrypted or otherwise, ever
  // leaves the server.
  const calendarState = buildCalendarPanelState(user.id);

  return (
    <div>
      <h2 className="mb-4">Preferences</h2>
      <SettingsLayout
        ariaLabel="Preference sections"
        sections={[
          {
            key: "profile",
            label: "Profile",
            element: (
              <ProfileSettingsPanel
                initial={{
                  name: user.name,
                  email: user.email,
                  pendingEmail: user.pendingEmail,
                }}
                confirmError={searchParams.error}
              />
            ),
          },
          {
            key: "password",
            label: "Password",
            element: <PasswordSettingsPanel />,
          },
          {
            key: "calendars",
            label: "Calendars",
            element: (
              <CalendarSettingsPanel
                initialState={calendarState}
                initialMessage={searchParams.calendarMessage}
                initialError={searchParams.calendarError}
              />
            ),
          },
          {
            key: "appearance",
            label: "Appearance",
            element: (
              <AppearanceSettingsPanel
                userId={user.id}
                savedPreference={user.themePreference}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
