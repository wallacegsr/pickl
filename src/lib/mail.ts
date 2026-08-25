import nodemailer from "nodemailer";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, SMTP_SETTINGS_ID } from "@/db/schema";
import { decrypt } from "@/lib/crypto";

interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
}

const DEFAULT_FROM = "no-reply@pickl.local";

/** Reads SMTP config from the DB `app_settings` singleton row, if present and usable. */
function getDbSmtpConfig(): SmtpConfig | null {
  const row = db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, SMTP_SETTINGS_ID))
    .get();
  if (!row || !row.smtpHost) return null;

  return {
    host: row.smtpHost,
    port: row.smtpPort || 587,
    user: row.smtpUser || undefined,
    // Decrypt lazily here (not stored decrypted anywhere) — only ever held
    // in memory for the duration of building the transport.
    pass: row.smtpPassEncrypted ? decrypt(row.smtpPassEncrypted) : undefined,
    from: row.smtpFrom || DEFAULT_FROM,
  };
}

/** Falls back to the SMTP_* env vars, exactly as before this feature existed. */
function getEnvSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST;
  if (!host) return null;

  return {
    host,
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || undefined,
    pass: process.env.SMTP_PASS || undefined,
    from: process.env.SMTP_FROM || DEFAULT_FROM,
  };
}

/**
 * Resolves the effective SMTP config: DB settings (admin panel) take
 * precedence when present and have a host configured; otherwise fall back
 * to env vars; otherwise null (caller logs to console instead of sending).
 */
function getSmtpConfig(): SmtpConfig | null {
  return getDbSmtpConfig() ?? getEnvSmtpConfig();
}

function buildTransport(config: SmtpConfig) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
  });
}

function getTransport(): { transport: nodemailer.Transporter; from: string } | null {
  const config = getSmtpConfig();
  if (!config) {
    console.warn(
      "SMTP is not configured (neither in /admin nor via SMTP_HOST) — emails will be logged to the console instead of sent."
    );
    return null;
  }
  return { transport: buildTransport(config), from: config.from };
}

export async function sendVerificationEmail(to: string, token: string) {
  const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
  const verifyUrl = `${baseUrl}/api/auth/verify?token=${encodeURIComponent(
    token
  )}`;

  const subject = "Verify your Pickl account";
  const text = `Welcome to Pickl!\n\nPlease verify your email address by visiting the link below:\n${verifyUrl}\n\nThis link expires in 24 hours.\n\nIf you did not sign up, you can ignore this email.`;
  const html = `
    <p>Welcome to <strong>Pickl</strong>!</p>
    <p>Please verify your email address by clicking the link below:</p>
    <p><a href="${verifyUrl}">${verifyUrl}</a></p>
    <p>This link expires in 24 hours.</p>
    <p>If you did not sign up, you can ignore this email.</p>
  `;

  const result = getTransport();
  if (!result) {
    console.log(`[mail:dev] Verification email for ${to}: ${verifyUrl}`);
    return;
  }

  await result.transport.sendMail({ from: result.from, to, subject, text, html });
}

export async function sendInviteEmail(
  to: string,
  token: string,
  invitedByName: string
) {
  const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
  const acceptUrl = `${baseUrl}/invite/accept?token=${encodeURIComponent(
    token
  )}`;

  const subject = "You've been invited to Pickl";
  const text = `${invitedByName} has invited you to join Pickl!\n\nSet up your account by visiting the link below:\n${acceptUrl}\n\nThis link expires in 24 hours.\n\nIf you weren't expecting this invitation, you can ignore this email.`;
  const html = `
    <p><strong>${invitedByName}</strong> has invited you to join <strong>Pickl</strong>!</p>
    <p>Set up your account by clicking the link below:</p>
    <p><a href="${acceptUrl}">${acceptUrl}</a></p>
    <p>This link expires in 24 hours.</p>
    <p>If you weren't expecting this invitation, you can ignore this email.</p>
  `;

  const result = getTransport();
  if (!result) {
    console.log(`[mail:dev] Invite email for ${to}: ${acceptUrl}`);
    return;
  }

  await result.transport.sendMail({ from: result.from, to, subject, text, html });
}

/**
 * Sends the confirmation link for a self-service email change to the NEW
 * address. Deliberately structured exactly like sendVerificationEmail /
 * sendInviteEmail above, console-log fallback included: until this link is
 * clicked the account still logs in with its old address, so if the new
 * address was a typo nothing is lost.
 */
export async function sendEmailChangeVerificationEmail(
  to: string,
  token: string,
  currentEmail: string
) {
  const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
  const confirmUrl = `${baseUrl}/api/auth/confirm-email-change?token=${encodeURIComponent(
    token
  )}`;

  const subject = "Confirm your new Pickl email address";
  const text = `A request was made to change the email address on the Pickl account currently using ${currentEmail} to this address.\n\nConfirm the change by visiting the link below:\n${confirmUrl}\n\nThis link expires in 24 hours. Until you confirm, the account keeps using ${currentEmail}.\n\nIf you did not request this, you can ignore this email.`;
  const html = `
    <p>A request was made to change the email address on the <strong>Pickl</strong> account currently using <strong>${currentEmail}</strong> to this address.</p>
    <p>Confirm the change by clicking the link below:</p>
    <p><a href="${confirmUrl}">${confirmUrl}</a></p>
    <p>This link expires in 24 hours. Until you confirm, the account keeps using ${currentEmail}.</p>
    <p>If you did not request this, you can ignore this email.</p>
  `;

  const result = getTransport();
  if (!result) {
    console.log(`[mail:dev] Email-change confirmation for ${to}: ${confirmUrl}`);
    return;
  }

  await result.transport.sendMail({ from: result.from, to, subject, text, html });
}

/**
 * Sends a test email using ONLY the settings currently saved in the DB
 * (never the env-var fallback) — this is what powers the "Send test
 * email" button on /admin's SMTP Settings panel, so it always reflects
 * exactly what's saved there. Throws (with nodemailer's real error
 * message intact) on failure — the API route surfaces this to the admin
 * rather than swallowing it, since surfacing real connection/auth errors
 * is the whole point of the feature.
 */
export async function sendTestEmail(to: string) {
  const config = getDbSmtpConfig();
  if (!config) {
    throw new Error(
      "No SMTP settings are saved yet. Save the SMTP Settings form below before sending a test email."
    );
  }

  const transport = buildTransport(config);
  const subject = "Pickl SMTP test";
  const text =
    "This is a test email from Pickl confirming your SMTP settings work.";
  const html = `<p>This is a test email from <strong>Pickl</strong> confirming your SMTP settings work.</p>`;

  await transport.sendMail({ from: config.from, to, subject, text, html });
}
