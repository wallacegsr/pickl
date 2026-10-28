import { NextRequest, NextResponse } from "next/server";
import { authenticateApiToken, type ApiPrincipal } from "@/lib/apiTokens";
import { resolvePlanContext, type ResolveError, type ResolveResult } from "@/lib/planContext";
import { clientIp, hit, isLimited } from "@/lib/rateLimit";

/**
 * The plumbing every /api/v1 route goes through, so none of them can forget
 * a step: Bearer token, scope, rate limits, the error shape, and no caching.
 *
 * /api/v1 accepts API tokens ONLY — never the browser's session cookie. A
 * cookie is sent by the browser on its own, which is what cross-site request
 * forgery relies on; a header Home Assistant has to add deliberately is not.
 * It also keeps this surface a stable contract while the routes the app's own
 * pages call stay free to change.
 */

/** Requests per token per minute. Home Assistant polling every few minutes uses a handful. */
const TOKEN_REQUESTS_PER_MINUTE = 120;
/** Failed authentications per client address per 15 minutes. */
const AUTH_FAILURES_PER_IP = 20;
const AUTH_FAILURE_WINDOW_MS = 15 * 60 * 1000;

const NO_STORE = { "Cache-Control": "no-store" };

export function apiJson(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(data, { status, headers: { ...NO_STORE, ...headers } });
}

export function apiError(status: number, error: string, headers: Record<string, string> = {}) {
  return apiJson({ error }, status, headers);
}

function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  const match = header?.match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : null;
}

/**
 * Authenticates by any credential the route allows (a Bearer header, or for
 * the calendar feed a key in the URL), applies the limits, then runs the
 * handler. `need` is the token scope required: a read token can never change
 * anything, and a feed key opens nothing but the feed.
 */
async function guarded(
  req: NextRequest,
  raw: string | null,
  need: "read" | "write" | "feed",
  handler: (principal: ApiPrincipal) => Response | Promise<Response>
): Promise<Response> {
  const ip = clientIp(req.headers);
  const failKey = `api:fail:${ip}`;
  if (isLimited(failKey, AUTH_FAILURES_PER_IP)) {
    return apiError(429, "Too many failed attempts. Try again later.");
  }

  const auth = authenticateApiToken(raw);
  if (!auth.ok) {
    if (auth.status === 401) hit(failKey, AUTH_FAILURES_PER_IP, AUTH_FAILURE_WINDOW_MS);
    return apiError(auth.status, auth.error, auth.status === 401 ? { "WWW-Authenticate": "Bearer" } : {});
  }
  const { principal } = auth;
  const scope = principal.token.scope;

  if (need === "feed" ? scope !== "feed" : scope === "feed") {
    return apiError(
      403,
      need === "feed"
        ? "This endpoint needs a calendar feed key."
        : "This is a calendar feed key. It only opens the calendar feed."
    );
  }
  if (need === "write" && scope !== "write") {
    return apiError(403, "This token is read-only. Create one with \"Read and change\" to make changes.");
  }

  const limit = hit(`api:token:${principal.token.id}`, TOKEN_REQUESTS_PER_MINUTE, 60 * 1000);
  if (!limit.allowed) {
    return apiError(429, "Too many requests. Slow down.", { "Retry-After": String(limit.retryAfter) });
  }

  try {
    return await handler(principal);
  } catch (err) {
    console.error(`[api] ${req.method} ${req.nextUrl.pathname} failed:`, err);
    return apiError(500, "Something went wrong.");
  }
}

/** For JSON endpoints: the token comes from `Authorization: Bearer pkl_…`. */
export function withApi(
  req: NextRequest,
  need: "read" | "write",
  handler: (principal: ApiPrincipal) => Response | Promise<Response>
) {
  return guarded(req, bearerToken(req), need, handler);
}

/** For the calendar feed only: the key comes from `?key=`, since Remote Calendar can send nothing else. */
export function withFeedKey(
  req: NextRequest,
  handler: (principal: ApiPrincipal) => Response | Promise<Response>
) {
  return guarded(req, req.nextUrl.searchParams.get("key"), "feed", handler);
}

/** What the audit log says about a change made through the API. */
export function auditNote(principal: ApiPrincipal): string {
  return `via API token "${principal.token.name}"`;
}

/**
 * The calendar an API call acts on: the household's (`shared`, the default)
 * or the token owner's own (`private`). There is no way to name another
 * person's private calendar through the API, even for an admin — a token in a
 * config file should be able to do less than its owner, never more.
 */
export function apiPlanContext(
  principal: ApiPrincipal,
  scope: string | null | undefined,
  mode: "read" | "write"
): ResolveResult | ResolveError {
  if (scope && scope !== "shared" && scope !== "private") {
    return { ok: false, status: 400, error: 'scope must be "shared" or "private".' };
  }
  return resolvePlanContext(principal.user, scope ?? "shared", null, mode);
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A YYYY-MM-DD that is also a real calendar date. */
export function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
