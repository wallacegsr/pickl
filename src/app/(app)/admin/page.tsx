import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, appSettings, SMTP_SETTINGS_ID } from "@/db/schema";
import { auth } from "@/lib/auth";
import { householdScope, isHouseholdAdmin, isPlatformAdmin } from "@/lib/permissions";
import { getHousehold, listHouseholds } from "@/lib/households";
import AdminUserTable from "@/components/AdminUserTable";
import HouseholdSettingsPanel from "@/components/HouseholdSettingsPanel";
import HouseholdTable from "@/components/HouseholdTable";
import SmtpSettingsPanel from "@/components/SmtpSettingsPanel";
import GoogleOAuthSettingsPanel from "@/components/GoogleOAuthSettingsPanel";
import SettingsLayout from "@/components/SettingsLayout";
import {
  getGoogleOauthSettings,
  getGoogleRedirectUri,
} from "@/lib/calendar/googleOAuth";

export const metadata = { title: "Back of House · Pickl" };

/**
 * Back of House, which is now two pages wearing one coat.
 *
 * A HOUSEHOLD admin gets their own family: its members and its name. A
 * PLATFORM admin gets the deployment: the list of households, email delivery
 * and the calendar client. Neither set leaks into the other, and on a
 * single-family install the same person holds both roles and sees the lot —
 * exactly as before households existed.
 *
 * The technical panels moved deliberately. SMTP credentials and an OAuth
 * client are deployment plumbing, not household settings; on a hosted
 * deployment a household admin has no business with either.
 */
export default async function AdminPage() {
  const session = await auth();
  const householdAdmin = isHouseholdAdmin(session?.user);
  const platformAdmin = isPlatformAdmin(session?.user);
  if (!householdAdmin && !platformAdmin) {
    redirect("/plan");
  }

  const householdId = householdScope(session?.user);
  const household = householdId ? getHousehold(householdId) : undefined;

  // A household admin administers their own family, and nobody else's.
  const allUsers =
    householdAdmin && householdId
      ? db.select().from(users).where(eq(users.householdId, householdId)).all()
      : [];
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

  const smtpRow = platformAdmin
    ? db
        .select()
        .from(appSettings)
        .where(eq(appSettings.id, SMTP_SETTINGS_ID))
        .get()
    : undefined;
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
  const oauthRow = platformAdmin ? getGoogleOauthSettings() : undefined;
  const googleOauth = {
    clientId: oauthRow?.clientId ?? "",
    hasClientSecret: Boolean(oauthRow?.clientSecretEncrypted),
    enabled: oauthRow?.enabled ?? false,
    redirectUri: getGoogleRedirectUri(),
  };

  const sections = [];

  if (householdAdmin && householdId) {
    sections.push({
      key: "users",
      label: "Users",
      element: (
        <AdminUserTable
          initialUsers={sanitized}
          currentUserId={session!.user.id}
        />
      ),
    });
    sections.push({
      key: "household",
      label: "Household",
      element: (
        <HouseholdSettingsPanel
          initialName={household?.name ?? ""}
          suspended={household?.suspended ?? false}
        />
      ),
    });
  }

  if (platformAdmin) {
    sections.push({
      key: "households",
      label: "Households",
      element: <HouseholdTable initialHouseholds={listHouseholds()} />,
    });
    sections.push({
      key: "smtp",
      label: "SMTP Settings",
      element: <SmtpSettingsPanel initialSettings={smtpSettings} />,
    });
    sections.push({
      key: "calendar",
      label: "Calendar Integration",
      element: <GoogleOAuthSettingsPanel initialSettings={googleOauth} />,
    });
  }

  return (
    <div>
      <h2 className="mb-1">Back of House</h2>
      <p className="text-muted mb-4">
        {platformAdmin
          ? "Households on this deployment, email delivery, and the calendar integration."
          : "Who is in this household, and what it is called."}
      </p>
      <SettingsLayout ariaLabel="Admin sections" sections={sections} />
    </div>
  );
}
