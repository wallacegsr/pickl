import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { appSettings, SMTP_SETTINGS_ID, type NewAppSettings } from "@/db/schema";
import { isAdmin } from "@/lib/permissions";
import { smtpSettingsSchema } from "@/lib/validators";
import { encrypt } from "@/lib/crypto";

function getRow() {
  return db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, SMTP_SETTINGS_ID))
    .get();
}

export async function GET() {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const row = getRow();

  return NextResponse.json({
    smtpHost: row?.smtpHost ?? "",
    smtpPort: row?.smtpPort ?? null,
    smtpUser: row?.smtpUser ?? "",
    smtpFrom: row?.smtpFrom ?? "",
    // Never the real password — just whether one is currently stored, so
    // the UI can show a masked placeholder instead of an empty field.
    hasPassword: Boolean(row?.smtpPassEncrypted),
    updatedAt: row?.updatedAt ?? null,
  });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = smtpSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }
  const data = parsed.data;

  const existing = getRow();

  const values: NewAppSettings = {
    id: SMTP_SETTINGS_ID,
    smtpHost: data.smtpHost || null,
    smtpPort: data.smtpPort ?? null,
    smtpUser: data.smtpUser || null,
    smtpFrom: data.smtpFrom || null,
    // Left blank on the form = keep whatever's already stored. Only
    // re-encrypt and overwrite when the admin actually typed something.
    smtpPassEncrypted: existing?.smtpPassEncrypted ?? null,
    updatedAt: new Date(),
    updatedByUserId: session.user.id,
  };
  if (data.smtpPassword) {
    values.smtpPassEncrypted = encrypt(data.smtpPassword);
  }

  db.insert(appSettings)
    .values(values)
    .onConflictDoUpdate({ target: appSettings.id, set: values })
    .run();

  const updated = getRow();

  return NextResponse.json({
    smtpHost: updated?.smtpHost ?? "",
    smtpPort: updated?.smtpPort ?? null,
    smtpUser: updated?.smtpUser ?? "",
    smtpFrom: updated?.smtpFrom ?? "",
    hasPassword: Boolean(updated?.smtpPassEncrypted),
    updatedAt: updated?.updatedAt ?? null,
  });
}
