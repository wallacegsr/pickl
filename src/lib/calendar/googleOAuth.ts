import { eq } from "drizzle-orm";
import { OAuth2Client } from "google-auth-library";
import { db } from "@/db";
import {
  googleOauthSettings,
  GOOGLE_OAUTH_SETTINGS_ID,
  type CalendarAccount,
  type GoogleOauthSettings,
} from "@/db/schema";
import { decrypt } from "@/lib/crypto";
import { ReauthRequiredError } from "./types";

/**
 * Per-user Google OAuth: client configuration, the consent URL, the code
 * exchange, access-token minting, calendar listing and revocation.
 *
 * Deliberately implemented with `google-auth-library` (which owns the
 * fiddly token endpoints and refresh handling) plus plain `fetch` against
 * the Calendar v3 REST API, rather than the full `googleapis` package — we
 * touch a handful of endpoints, and `googleapis` would add tens of
 * megabytes to the Docker image for them.
 *
 * NOTE: this module must stay import-side-effect-free (see src/db/index.ts)
 * — every DB read below happens inside a function.
 */

/**
 * The narrowest scope set that does the job:
 *  - calendar.events                — create/update/delete our own events
 *  - calendar.calendarlist.readonly — let the user pick which of THEIR
 *                                     calendars to mirror into
 *  - openid, email                  — label the connection with the Google
 *                                     address they authorized
 * Nothing broader is requested: notably not `calendar`, which would grant
 * full read of every event in every calendar they own.
 */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "openid",
  "email",
];

const TOKEN_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

/** The app's public base URL, matching the convention in src/lib/mail.ts. */
export function getAppBaseUrl(): string {
  return (
    process.env.APP_BASE_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000"
  ).replace(/\/+$/, "");
}

/**
 * The exact redirect URI that must be registered on the OAuth client in
 * Google Cloud. Shown verbatim (and copyable) in the admin panel, because
 * a mismatch here is the single most common setup failure.
 */
export function getGoogleRedirectUri(): string {
  return `${getAppBaseUrl()}/api/calendar/google/callback`;
}

/**
 * Where the connect/callback routes send the browser back to: the
 * Calendars section of Preferences, optionally carrying a short message.
 */
export function preferencesCalendarsUrl(
  params: Record<string, string> = {}
): string {
  const url = new URL(`${getAppBaseUrl()}/preferences`);
  url.searchParams.set("section", "calendars");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function getGoogleOauthSettings(): GoogleOauthSettings | undefined {
  return db
    .select()
    .from(googleOauthSettings)
    .where(eq(googleOauthSettings.id, GOOGLE_OAUTH_SETTINGS_ID))
    .get();
}

export interface GoogleClientCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Whether an admin has configured (and enabled) OAuth client credentials.
 * The Preferences UI uses this to show an explanatory state instead of a
 * Connect button that could only ever fail.
 */
export function isGoogleOauthConfigured(): boolean {
  const row = getGoogleOauthSettings();
  return Boolean(row?.enabled && row.clientId && row.clientSecretEncrypted);
}

/**
 * Decrypts the client credentials. Throws a message safe to show a user
 * verbatim; never echoes the secret.
 */
export function getGoogleClientCredentials(): GoogleClientCredentials {
  const row = getGoogleOauthSettings();
  if (!row || !row.clientId || !row.clientSecretEncrypted) {
    throw new Error(
      "Google Calendar sync is not configured on this server. An administrator needs to add OAuth client credentials under Admin → Calendar Integration."
    );
  }
  if (!row.enabled) {
    throw new Error(
      "Google Calendar sync is currently disabled by an administrator."
    );
  }
  return {
    clientId: row.clientId,
    clientSecret: decrypt(row.clientSecretEncrypted),
  };
}

function createClient(): OAuth2Client {
  const { clientId, clientSecret } = getGoogleClientCredentials();
  return new OAuth2Client({
    clientId,
    clientSecret,
    redirectUri: getGoogleRedirectUri(),
  });
}

/**
 * The consent URL to send the user to.
 *
 * `access_type=offline` + `prompt=consent` together are what make Google
 * actually issue a refresh token: without offline access there is none,
 * and without forcing the consent prompt Google silently omits it on every
 * authorization after the first, leaving us with a connection that dies in
 * an hour.
 */
export function buildConsentUrl(state: string): string {
  return createClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: false,
    scope: GOOGLE_SCOPES,
    state,
  });
}

export interface CodeExchangeResult {
  refreshToken: string;
  accessToken: string | null;
  scopes: string;
  accountEmail: string | null;
}

/** Turns a Google API/auth error into one readable line, never echoing tokens. */
export function describeGoogleError(err: unknown): string {
  const anyErr = err as {
    response?: { data?: { error?: string; error_description?: string } };
    message?: string;
  };
  const data = anyErr?.response?.data;
  if (data?.error_description || data?.error) {
    return String(data.error_description || data.error);
  }
  return anyErr?.message || String(err);
}

/** Exchanges an authorization code for tokens and the account's email. */
export async function exchangeCodeForTokens(
  code: string
): Promise<CodeExchangeResult> {
  const client = createClient();
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Remove Pickl from your Google account's third-party access list and try connecting again."
    );
  }

  let accountEmail: string | null = null;
  if (tokens.access_token) {
    accountEmail = await fetchAccountEmail(tokens.access_token).catch(
      () => null
    );
  }

  return {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token ?? null,
    scopes: tokens.scope ?? GOOGLE_SCOPES.join(" "),
    accountEmail,
  };
}

async function fetchAccountEmail(accessToken: string): Promise<string | null> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as {
    email?: string;
  } | null;
  return data?.email ?? null;
}

/**
 * Mints a fresh access token from a stored refresh token.
 *
 * Access tokens live ~1 hour and are never persisted — we hold them only
 * for the lifetime of one provider instance. A rejected refresh token is
 * translated into ReauthRequiredError so callers can record an actionable
 * "reconnect needed" state rather than a generic failure.
 */
export async function getAccessTokenForAccount(
  account: CalendarAccount
): Promise<string> {
  if (!account.refreshTokenEncrypted) {
    throw new ReauthRequiredError(
      "No Google authorization is stored for this account. Connect your Google account again."
    );
  }
  const refreshToken = decrypt(account.refreshTokenEncrypted);
  const client = createClient();
  client.setCredentials({ refresh_token: refreshToken });

  try {
    const { token } = await client.getAccessToken();
    if (!token) {
      throw new ReauthRequiredError(
        "Google did not return an access token. Reconnect your Google account."
      );
    }
    return token;
  } catch (err) {
    if (err instanceof ReauthRequiredError) throw err;
    const detail = describeGoogleError(err);
    // `invalid_grant` is Google's catch-all for "this refresh token is
    // dead": revoked by the user, or expired because the OAuth consent
    // screen is still in Testing (7-day token lifetime).
    if (/invalid_grant|unauthorized_client|invalid_client/i.test(detail)) {
      throw new ReauthRequiredError(
        `Google rejected the stored authorization (${detail}). Reconnect your Google account — if this keeps happening weekly, ask your administrator to set the OAuth consent screen to "In production".`
      );
    }
    throw new Error(`Google authentication failed: ${detail}`);
  }
}

export interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  primary: boolean;
  /** True when the user can actually write events to it. */
  writable: boolean;
}

/**
 * The user's own calendar list, so they can pick a mirroring target.
 * Read-only, and only ever called with that user's own access token.
 */
export async function listUserCalendars(
  accessToken: string
): Promise<GoogleCalendarListEntry[]> {
  const res = await fetch(
    `${CALENDAR_API_BASE}/users/me/calendarList?minAccessRole=writer&maxResults=250`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Could not load your Google calendars (HTTP ${res.status})${
        text ? `: ${text.slice(0, 300)}` : ""
      }`
    );
  }
  const data = (await res.json().catch(() => null)) as {
    items?: Array<{
      id?: string;
      summary?: string;
      primary?: boolean;
      accessRole?: string;
    }>;
  } | null;

  return (data?.items ?? [])
    .filter((item): item is { id: string } & typeof item =>
      Boolean(item.id)
    )
    .map((item) => ({
      id: item.id,
      summary: item.summary || item.id,
      primary: Boolean(item.primary),
      writable: item.accessRole === "owner" || item.accessRole === "writer",
    }))
    .filter((item) => item.writable);
}

/**
 * Asks Google to invalidate the refresh token.
 *
 * Called on disconnect so that a stolen database backup cannot be replayed
 * against the user's calendar later. Best-effort: if Google is unreachable
 * we still delete our local copy, which is the part we actually control.
 */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const res = await fetch(TOKEN_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }).toString(),
  });
  // 200 = revoked. 400 usually means "already invalid", which is the
  // desired end state anyway.
  if (!res.ok && res.status !== 400) {
    throw new Error(`Google token revocation failed (HTTP ${res.status}).`);
  }
}
