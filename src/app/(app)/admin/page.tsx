import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, appSettings, SMTP_SETTINGS_ID } from "@/db/schema";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import AdminUserTable from "@/components/AdminUserTable";
import SmtpSettingsPanel from "@/components/SmtpSettingsPanel";
import GoogleOAuthSettingsPanel from "@/components/GoogleOAuthSettingsPanel";
import SettingsLayout from "@/components/SettingsLayout";
import {
  getGoogleOauthSettings,
  getGoogleRedirectUri,
} from "@/lib/calendar/googleOAuth";

export const metadata = { title: "Back of House · Pickl" };

export default async function AdminPage() {
  const session = await auth();
  if (!isAdmin(session?.user)) {
    redirect("/plan");
  }

  const allUsers = db.select().from(users).all();
  const sanitized = allUsers.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active,
    verified: Boolean(u.emailVerified),
    canAccessSharedCalendar: u.canAccessSharedCalendar,
    isGlobalAdmin: u.isGlobalAdmin,
  }));

  const smtpRow = db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, SMTP_SETTINGS_ID))
    .get();
  const smtpSettings = {
    smtpHost: smtpRow?.smtpHost ?? "",
    smtpPort: smtpRow?.smtpPort ?? null,
    smtpUser: smtpRow?.smtpUser ?? "",
    smtpFrom: smtpRow?.smtpFrom ?? "",
    hasPassword: Boolean(smtpRow?.smtpPassEncrypted),
  };

  // OAuth CLIENT credentials only — the entirety of the admin's calendar
  // surface. There is deliberately no listing of who has connected an
  // account and no path for an admin to see or operate another user's
  // calendar connection (see /api/calendar/**). The secret itself is never
  // sent to the client, only whether one is stored.
  const oauthRow = getGoogleOauthSettings();
  const googleOauth = {
    clientId: oauthRow?.clientId ?? "",
    hasClientSecret: Boolean(oauthRow?.clientSecretEncrypted),
    enabled: oauthRow?.enabled ?? false,
    redirectUri: getGoogleRedirectUri(),
  };

  return (
    <div>
      <h2 className="mb-1">Back of House</h2>
      <p className="text-muted mb-4">
        User accounts, email delivery, and the calendar integration.
      </p>
      <SettingsLayout
        ariaLabel="Admin sections"
        sections={[
          {
            key: "users",
            label: "Users",
            element: (
              <AdminUserTable
                initialUsers={sanitized}
                currentUserId={session!.user.id}
              />
            ),
          },
          {
            key: "smtp",
            label: "SMTP Settings",
            element: <SmtpSettingsPanel initialSettings={smtpSettings} />,
          },
          {
            key: "calendar",
            label: "Calendar Integration",
            element: (
              <GoogleOAuthSettingsPanel initialSettings={googleOauth} />
            ),
          },
        ]}
      />
    </div>
  );
}
