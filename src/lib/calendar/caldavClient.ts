import {
  assertCaldavUrlAllowed,
  CaldavUrlError,
  normalizeCaldavUrl,
} from "./caldavUrl";
import { childrenNamed, findAll, findFirst, parseXml, textOf } from "./caldavXml";

/**
 * A small CalDAV client: RFC 6764 service discovery, plus the three
 * requests the sync layer actually needs (PUT, DELETE, HEAD).
 *
 * ## Why this is hand-rolled rather than `tsdav`
 *
 * `tsdav` was the obvious candidate and is genuinely fine software —
 * actively maintained (2.3.1, published weeks ago) and light on
 * dependencies (`debug` + `xml-js`), so image size was not the objection.
 *
 * The objection is that the security properties this integration needs
 * live exactly where a library abstracts them away. Every request here has
 * to (a) carry a hard timeout, (b) re-validate the destination against the
 * SSRF rules in ./caldavUrl *on every redirect hop*, and (c) drop the
 * Authorization header when a redirect crosses origins. `tsdav` performs
 * its own `fetch` calls internally and its `fetchOptions` passthrough
 * cannot express "re-check the target between hops" — to get that we would
 * have to set `redirect: "manual"` and re-implement the redirect walk
 * ourselves, at which point the discovery dance is most of what is left,
 * and it is ~120 lines.
 *
 * We also need only four request shapes, none of which involve the parts
 * of CalDAV that are actually hard (no calendar-query REPORT, no free/busy,
 * no sync-collection, no recurrence expansion). Pickl writes one
 * single-instance VEVENT per plan slot and never reads events back.
 *
 * So: no new dependency, full control of the network boundary. If this
 * ever grows to two-way sync, `tsdav` becomes the right call.
 *
 * This module is import-side-effect-free (see src/db/index.ts) and touches
 * no database.
 */

/** Per-request ceiling. A dead server must never hold a request open. */
const REQUEST_TIMEOUT_MS = 15_000;
/**
 * Ceiling for a whole discovery walk, which is up to five requests (three
 * candidate start points, then principal and home). Without a shared
 * budget those timeouts stack, and a silent server would hold the connect
 * request open for over a minute. Threaded through as an absolute
 * deadline so every hop shortens its own timeout to what is left.
 */
const DISCOVERY_BUDGET_MS = 20_000;
/** Never give a request less than this, or the budget itself causes the failure. */
const MIN_REQUEST_TIMEOUT_MS = 2_000;
const MAX_REDIRECTS = 5;
/** Enough for a calendar-home listing; anything larger is a server bug. */
const MAX_RESPONSE_BYTES = 2_000_000;

export interface CaldavCredentials {
  serverUrl: string;
  username: string;
  password: string;
}

export interface CaldavCalendar {
  /** Absolute collection URL — this is what gets stored as target.calendarId. */
  url: string;
  displayName: string;
  /** False when the server told us we only have read access. */
  writable: boolean;
}

/**
 * A CalDAV failure with a message written for the person who typed the
 * URL, not for a log file. `status` is present for HTTP-level failures.
 */
export class CaldavError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "CaldavError";
    this.status = status;
  }
}

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

/**
 * Turns a transport-level failure into something actionable. Node's fetch
 * hides the interesting part in `cause`, so TLS and DNS problems otherwise
 * all arrive as the useless string "fetch failed".
 */
function describeNetworkError(err: unknown, url: URL): CaldavError {
  const cause = (err as { cause?: unknown })?.cause;
  const code =
    (cause as { code?: string })?.code ?? (err as { code?: string })?.code ?? "";
  const host = `${url.protocol}//${url.host}`;

  // A connection that opens and then goes silent surfaces as a
  // TimeoutError from AbortSignal.timeout — sometimes on the error
  // itself, sometimes wrapped in `cause` by undici. Both spellings, plus
  // plain AbortError, mean the same thing to the user.
  const names = [
    (err as { name?: string })?.name,
    (cause as { name?: string })?.name,
  ];
  if (names.some((n) => n === "TimeoutError" || n === "AbortError")) {
    return new CaldavError(`${host} did not respond in time.`);
  }
  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return new CaldavError(`Could not find the server ${url.host}. Check the address.`);
    case "ECONNREFUSED":
      return new CaldavError(`${host} refused the connection. Check the address and port.`);
    case "ECONNRESET":
      return new CaldavError(`${host} closed the connection unexpectedly.`);
    case "ETIMEDOUT":
      return new CaldavError(`${host} did not respond.`);
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
      return new CaldavError(
        `${host} presented a certificate that could not be verified (self-signed, or missing an intermediate). Pickl will not send your password over an untrusted connection.`
      );
    case "CERT_HAS_EXPIRED":
      return new CaldavError(`The TLS certificate for ${url.host} has expired.`);
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return new CaldavError(
        `The TLS certificate for ${url.host} is issued for a different hostname.`
      );
    default: {
      const detail =
        cause instanceof Error ? cause.message : err instanceof Error ? err.message : String(err);
      return new CaldavError(`Could not reach ${host}: ${detail}`);
    }
  }
}

interface DavResponse {
  status: number;
  headers: Headers;
  body: string;
  /** Where the request finally landed, after any redirects. */
  url: URL;
}

/**
 * The single network chokepoint. Everything below goes through here, so
 * the timeout, the redirect policy and the SSRF re-validation are
 * impossible to forget in one call site.
 */
async function davFetch(
  method: string,
  rawUrl: URL,
  credentials: CaldavCredentials,
  options: {
    body?: string;
    contentType?: string;
    depth?: "0" | "1";
    extraHeaders?: Record<string, string>;
    /** Absolute time (ms) this whole operation must be finished by. */
    deadlineAt?: number;
  } = {}
): Promise<DavResponse> {
  const origin = rawUrl.origin;
  let url = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertCaldavUrlAllowed(url);

    const headers: Record<string, string> = {
      // Auth only travels to the origin the user actually typed. A server
      // that redirects us elsewhere gets an unauthenticated request; if it
      // wants credentials it will 401, and we tell the user to enter that
      // URL directly rather than shipping their password to a host they
      // never named.
      ...(url.origin === origin
        ? { Authorization: basicAuthHeader(credentials.username, credentials.password) }
        : {}),
      ...(options.depth ? { Depth: options.depth } : {}),
      ...(options.contentType ? { "Content-Type": options.contentType } : {}),
      ...options.extraHeaders,
    };

    // AbortSignal.timeout settles the promise itself — nothing is left
    // hanging in the detached push path when a server stops responding.
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: options.body,
        redirect: "manual",
        signal: AbortSignal.timeout(
          options.deadlineAt
            ? Math.max(MIN_REQUEST_TIMEOUT_MS, Math.min(REQUEST_TIMEOUT_MS, options.deadlineAt - Date.now()))
            : REQUEST_TIMEOUT_MS
        ),
      });
    } catch (err) {
      throw describeNetworkError(err, url);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) {
        throw new CaldavError(
          `${url.host} sent a ${res.status} redirect with no destination.`,
          res.status
        );
      }
      let next: URL;
      try {
        next = normalizeCaldavUrl(new URL(location, url).toString());
      } catch (err) {
        if (err instanceof CaldavUrlError) {
          throw new CaldavError(`The server redirected somewhere Pickl won't follow: ${err.message}`);
        }
        throw err;
      }
      // Drain so the socket is released before the next hop.
      await res.text().catch(() => "");
      url = next;
      continue;
    }

    const length = Number(res.headers.get("content-length") ?? "0");
    if (length > MAX_RESPONSE_BYTES) {
      throw new CaldavError(`${url.host} returned an unexpectedly large response.`);
    }
    let body = "";
    if (method !== "HEAD") {
      body = await res.text().catch(() => "");
      if (body.length > MAX_RESPONSE_BYTES) body = body.slice(0, MAX_RESPONSE_BYTES);
    }
    return { status: res.status, headers: res.headers, body, url };
  }

  throw new CaldavError(`${rawUrl.host} redirected too many times.`);
}

/** Maps the handful of status codes that mean something specific to a user. */
function assertOk(res: DavResponse, what: string): void {
  if (res.status >= 200 && res.status < 300) return;
  switch (res.status) {
    case 401:
      throw new CaldavError(
        "The server rejected your username or app password. Note that most providers (iCloud, Fastmail) require an app-specific password rather than your account password.",
        401
      );
    case 403:
      throw new CaldavError(
        "The server accepted your credentials but refused the request. Your account may not have permission to write to this calendar.",
        403
      );
    case 404:
      throw new CaldavError(`${what} was not found on the server (404).`, 404);
    case 405:
      throw new CaldavError(
        "That URL doesn't speak CalDAV. Check your provider's documentation for the correct server address.",
        405
      );
    case 507:
      throw new CaldavError("The server is out of storage space for this calendar.", 507);
    default:
      throw new CaldavError(`The server returned ${res.status} for ${what}.`, res.status);
  }
}

async function propfind(
  url: URL,
  credentials: CaldavCredentials,
  depth: "0" | "1",
  body: string,
  deadlineAt?: number
): Promise<DavResponse> {
  return davFetch("PROPFIND", url, credentials, {
    body,
    depth,
    deadlineAt,
    contentType: 'application/xml; charset="utf-8"',
  });
}

const PRINCIPAL_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/><d:principal-URL/></d:prop></d:propfind>`;

const HOME_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`;

const CALENDARS_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
    <d:current-user-privilege-set/>
    <c:supported-calendar-component-set/>
  </d:prop>
</d:propfind>`;

/** Resolves an href from a multistatus body against the request URL. */
function resolveHref(href: string, base: URL): URL | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed, base);
  } catch {
    return null;
  }
}

/**
 * Step 1 of RFC 6764: find the current user's principal URL.
 *
 * Servers vary in what they accept as a starting point, so we try, in
 * order: the URL the user gave us, `/.well-known/caldav`, and the server
 * root. Fastmail users paste the root; iCloud users paste
 * `https://caldav.icloud.com`; Nextcloud users paste anything from the
 * base URL to a full `/remote.php/dav/calendars/alice/` path. All of them
 * land somewhere in this list.
 */
async function discoverPrincipal(
  base: URL,
  credentials: CaldavCredentials,
  deadlineAt: number
): Promise<URL> {
  const candidates: URL[] = [base];
  const wellKnown = new URL("/.well-known/caldav", base);
  if (wellKnown.href !== base.href) candidates.push(wellKnown);
  const root = new URL("/", base);
  if (!candidates.some((c) => c.href === root.href)) candidates.push(root);

  let lastError: CaldavError | null = null;
  for (const candidate of candidates) {
    // Out of budget: stop trying alternatives and report the last real
    // problem rather than burning the caller's request on a fourth guess.
    if (Date.now() >= deadlineAt && lastError) break;
    let res: DavResponse;
    try {
      res = await propfind(candidate, credentials, "0", PRINCIPAL_BODY, deadlineAt);
    } catch (err) {
      lastError = err instanceof CaldavError ? err : new CaldavError(String(err));
      // Bad credentials will be bad at every candidate — stop immediately
      // rather than making three more attempts that could trip a
      // provider's failed-login lockout.
      if (lastError.status === 401) throw lastError;
      continue;
    }
    if (res.status === 401) {
      assertOk(res, "the server");
    }
    if (res.status !== 207) {
      lastError = new CaldavError(
        `The server returned ${res.status} instead of a CalDAV response.`,
        res.status
      );
      continue;
    }

    const doc = parseXml(res.body);
    const principalNode =
      findFirst(doc, "current-user-principal") ?? findFirst(doc, "principal-url");
    const href = textOf(findFirst(principalNode ?? doc, "href"));
    const resolved = href ? resolveHref(href, res.url) : null;
    if (resolved) return resolved;
    lastError = new CaldavError(
      "The server answered but didn't identify your account (no current-user-principal)."
    );
  }

  throw (
    lastError ??
    new CaldavError("Could not find a CalDAV service at that address.")
  );
}

/** Step 2: the principal's calendar-home-set. */
async function discoverCalendarHome(
  principal: URL,
  credentials: CaldavCredentials,
  deadlineAt: number
): Promise<URL> {
  const res = await propfind(principal, credentials, "0", HOME_BODY, deadlineAt);
  if (res.status !== 207) assertOk(res, "your CalDAV principal");

  const doc = parseXml(res.body);
  const homeNode = findFirst(doc, "calendar-home-set");
  const href = textOf(findFirst(homeNode ?? doc, "href"));
  const resolved = href ? resolveHref(href, res.url) : null;
  if (!resolved) {
    throw new CaldavError(
      "The server didn't report a calendar home for your account, so Pickl can't tell where your calendars live."
    );
  }
  return resolved;
}

/** Step 3: enumerate the home collection and keep the VEVENT calendars. */
async function listCalendarsInHome(
  home: URL,
  credentials: CaldavCredentials,
  deadlineAt: number
): Promise<CaldavCalendar[]> {
  const res = await propfind(home, credentials, "1", CALENDARS_BODY, deadlineAt);
  if (res.status !== 207) assertOk(res, "your calendar home");

  const doc = parseXml(res.body);
  const calendars: CaldavCalendar[] = [];

  for (const response of findAll(doc, "response")) {
    const href = textOf(childrenNamed(response, "href")[0]);
    const url = href ? resolveHref(href, res.url) : null;
    if (!url) continue;
    // The home collection itself comes back in a Depth:1 listing; skip it.
    if (url.href.replace(/\/$/, "") === res.url.href.replace(/\/$/, "")) continue;

    // Only look at propstats that actually succeeded.
    const okProps = findAll(response, "propstat").filter((ps) => {
      const status = textOf(findFirst(ps, "status"));
      return !status || / 2\d\d /.test(` ${status} `) || status.includes(" 200 ");
    });
    if (okProps.length === 0) continue;

    const resourceType = okProps.map((ps) => findFirst(ps, "resourcetype")).find(Boolean);
    const isCalendar = resourceType
      ? resourceType.children.some((c) => c.name === "calendar")
      : false;
    if (!isCalendar) continue;

    // A calendar collection may advertise which components it holds. When
    // it does and VEVENT isn't among them (an iCloud reminders/VTODO list,
    // say), it cannot hold our events. When it says nothing, RFC 4791 says
    // assume all components are supported.
    const componentSet = okProps
      .map((ps) => findFirst(ps, "supported-calendar-component-set"))
      .find(Boolean);
    if (componentSet) {
      const comps = childrenNamed(componentSet, "comp").map((c) =>
        (c.attrs.name ?? "").toUpperCase()
      );
      if (comps.length > 0 && !comps.includes("VEVENT")) continue;
    }

    // Privileges, when reported. Absent means "the server didn't say" —
    // treated as writable, because a PUT is the only real test anyway.
    const privileges = okProps
      .map((ps) => findFirst(ps, "current-user-privilege-set"))
      .find(Boolean);
    let writable = true;
    if (privileges) {
      const granted = findAll(privileges, "privilege").flatMap((p) =>
        p.children.map((c) => c.name)
      );
      if (granted.length > 0) {
        writable = granted.includes("write") || granted.includes("write-content") || granted.includes("all");
      }
    }

    const displayName =
      okProps.map((ps) => textOf(findFirst(ps, "displayname"))).find((n) => n) ||
      decodeURIComponent(url.pathname.replace(/\/$/, "").split("/").pop() || "Calendar");

    calendars.push({ url: url.href, displayName, writable });
  }

  calendars.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return calendars;
}

export interface DiscoveryResult {
  principalUrl: string;
  homeUrl: string;
  calendars: CaldavCalendar[];
}

/**
 * The whole discovery dance, from "a URL the user typed" to "calendars
 * they can pick from". Throws `CaldavError` with a message worth showing.
 */
export async function discoverCalendars(
  credentials: CaldavCredentials
): Promise<DiscoveryResult> {
  const base = normalizeCaldavUrl(credentials.serverUrl);
  await assertCaldavUrlAllowed(base);

  // One budget for the whole walk, so a silent server costs the user ~20
  // seconds in total rather than 15 per hop.
  const deadlineAt = Date.now() + DISCOVERY_BUDGET_MS;

  const principal = await discoverPrincipal(base, credentials, deadlineAt);
  const home = await discoverCalendarHome(principal, credentials, deadlineAt);
  const calendars = await listCalendarsInHome(home, credentials, deadlineAt);

  if (calendars.length === 0) {
    throw new CaldavError(
      "Connected successfully, but no calendars that can hold events were found for this account. Create a calendar on the server first."
    );
  }
  return {
    principalUrl: principal.href,
    homeUrl: home.href,
    calendars,
  };
}

/** Result of a conditional write. */
export interface PutResult {
  /** The ETag the server assigned, when it returned one. */
  etag: string | null;
}

function normalizeEtag(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length < 300 ? trimmed : null;
}

/**
 * PUTs an iCalendar body to a resource URL.
 *
 * Conditional-request policy (see the class comment in ./caldav for why):
 *  - `ifMatch`   — update an event we believe we know the ETag of.
 *  - `ifNoneMatch: "*"` — create, refusing to overwrite anything already
 *    at that URL.
 */
export async function putEvent(
  credentials: CaldavCredentials,
  resourceUrl: string,
  icsBody: string,
  conditions: { ifMatch?: string | null; ifNoneMatch?: "*" } = {}
): Promise<PutResult | "precondition-failed"> {
  const url = normalizeCaldavUrl(resourceUrl);
  const extraHeaders: Record<string, string> = {};
  if (conditions.ifMatch) extraHeaders["If-Match"] = conditions.ifMatch;
  else if (conditions.ifNoneMatch) extraHeaders["If-None-Match"] = "*";

  const res = await davFetch("PUT", url, credentials, {
    body: icsBody,
    contentType: "text/calendar; charset=utf-8",
    extraHeaders,
  });

  if (res.status === 412 || res.status === 409) return "precondition-failed";
  assertOk(res, "the event");
  return { etag: normalizeEtag(res.headers.get("etag")) };
}

/** DELETEs a resource. `ifMatch` guards against removing an edited event. */
export async function deleteEvent(
  credentials: CaldavCredentials,
  resourceUrl: string,
  ifMatch?: string | null
): Promise<"deleted" | "already-gone" | "precondition-failed"> {
  const url = normalizeCaldavUrl(resourceUrl);
  const res = await davFetch("DELETE", url, credentials, {
    extraHeaders: ifMatch ? { "If-Match": ifMatch } : {},
  });

  if (res.status === 404 || res.status === 410) return "already-gone";
  if (res.status === 412) return "precondition-failed";
  assertOk(res, "the event");
  return "deleted";
}

/** Current ETag for a resource, or null if it isn't there. */
export async function headEvent(
  credentials: CaldavCredentials,
  resourceUrl: string
): Promise<{ exists: boolean; etag: string | null }> {
  const url = normalizeCaldavUrl(resourceUrl);
  const res = await davFetch("HEAD", url, credentials);
  if (res.status === 404 || res.status === 410) return { exists: false, etag: null };
  assertOk(res, "the event");
  return { exists: true, etag: normalizeEtag(res.headers.get("etag")) };
}

/**
 * Credentials check used by the connect form: proves the server answers,
 * the password works, and at least one usable calendar exists.
 */
export async function testConnection(
  credentials: CaldavCredentials
): Promise<DiscoveryResult> {
  return discoverCalendars(credentials);
}
