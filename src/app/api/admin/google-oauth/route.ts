import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import {
  googleOauthSettings,
  GOOGLE_OAUTH_SETTINGS_ID,
  type NewGoogleOauthSettings,
} from "@/db/schema";
import { isAdmin } from "@/lib/permissions";
import { googleOauthSettingsSchema } from "@/lib/validators";
import { encrypt } from "@/lib/crypto";
import { logAuditEntry } from "@/lib/audit";
import { getGoogleRedirectUri } from "@/lib/calendar/googleOAuth";

/**
 * The OAuth **client** credentials — the only calendar setting an admin
 * owns. Deliberately nothing here reads, lists, or touches any user's
 * connected Google account or sync targets: there is no admin override,
 * which is the whole point of the per-user OAuth model.
 */

function getRow() {
  return db
    .select()
    .from(googleOauthSettings)
    .where(eq(googleOauthSettings.id, GOOGLE_OAUTH_SETTINGS_ID))
    .get();
}

function toResponse() {
  const row = getRow();
  return {
    clientId: row?.clientId ?? "",
    // Never the secret, in any form — just whether one is stored, so the
    // UI can show a masked placeholder instead of an empty field.
    hasClientSecret: Boolean(row?.clientSecretEncrypted),
    enabled: row?.enabled ?? false,
    redirectUri: getGoogleRedirectUri(),
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(toResponse());
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = googleOauthSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }
  const data = parsed.data;
  const existing = getRow();

  if (data.enabled && !data.clientId) {
    return NextResponse.json(
      { error: "A client ID is required before Google Calendar sync can be enabled." },
      { status: 400 }
    );
  }
  if (data.enabled && !data.clientSecret && !existing?.clientSecretEncrypted) {
    return NextResponse.json(
      { error: "A client secret is required before Google Calendar sync can be enabled." },
      { status: 400 }
    );
  }

  const values: NewGoogleOauthSettings = {
    id: GOOGLE_OAUTH_SETTINGS_ID,
    clientId: data.clientId || null,
    // Left blank on the form = keep whatever's already stored. Only
    // re-encrypt and overwrite when the admin actually typed something.
    clientSecretEncrypted: existing?.clientSecretEncrypted ?? null,
    enabled: data.enabled,
    updatedAt: new Date(),
    updatedByUserId: session.user.id,
  };
  if (data.clientSecret) {
    values.clientSecretEncrypted = encrypt(data.clientSecret);
  }

  db.insert(googleOauthSettings)
    .values(values)
    .onConflictDoUpdate({ target: googleOauthSettings.id, set: values })
    .run();

  // Non-secret context only: whether sync is on and whether a secret is
  // now stored. Never the client id's secret half.
  logAuditEntry({
    userId: session.user.id,
    action: "calendar_oauth_config",
    notes: `google oauth client updated (enabled=${data.enabled}, secretStored=${Boolean(
      values.clientSecretEncrypted
    )})`,
  });

  return NextResponse.json(toResponse());
}
