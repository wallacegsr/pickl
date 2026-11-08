/**
 * A small fixed-window limiter for the routes anyone can call without an
 * account: login, signup, resending a verification email, accepting an
 * invite.
 *
 * In memory, per process. Pickl runs as one container with one Node process,
 * so that is the whole deployment; a restart clears it, which is acceptable
 * for a limiter whose job is to make guessing slow, not impossible. If Pickl is
 * ever scaled out, this needs to move into the database.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Past this many keys, expired windows are swept on the next check. */
const SWEEP_AT = 5000;

function sweep(now: number) {
  for (const [key, w] of windows) if (w.resetAt <= now) windows.delete(key);
}

/**
 * Counts one attempt against `key`. Returns false once `limit` attempts have
 * been made inside `windowMs` — the caller should refuse — and how many
 * seconds remain before the window resets.
 */
export function hit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  if (windows.size > SWEEP_AT) sweep(now);
  let w = windows.get(key);
  if (!w || w.resetAt <= now) {
    w = { count: 0, resetAt: now + windowMs };
    windows.set(key, w);
  }
  w.count += 1;
  return { allowed: w.count <= limit, retryAfter: Math.ceil((w.resetAt - now) / 1000) };
}

/** Whether `key` is currently over its limit, without counting an attempt. */
export function isLimited(key: string, limit: number): boolean {
  const w = windows.get(key);
  return Boolean(w && w.resetAt > Date.now() && w.count >= limit);
}

/** Forgets `key` — after a successful login, say. */
export function clear(key: string) {
  windows.delete(key);
}

/**
 * How many reverse proxies stand in front of the app, from TRUSTED_PROXY_HOPS.
 * One (the default) is the usual nginx, Caddy, Traefik or DSM proxy.
 */
function trustedProxyHops(): number {
  const hops = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "", 10);
  return Number.isInteger(hops) && hops >= 1 ? hops : 1;
}

/**
 * The caller's address, as the reverse proxy reports it.
 *
 * Read from the right of X-Forwarded-For, never the left. Each proxy appends
 * the address it was connected from, so the last entry is the one our own
 * proxy wrote; anything to the left of the entries our proxies added came
 * from the client and can say anything. Taking the first entry let anyone
 * send a fresh made-up address with every login attempt and never meet the
 * per-address limit.
 */
export function clientIp(headers: Headers): string {
  const forwarded = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (forwarded.length > 0) {
    return forwarded[Math.max(forwarded.length - trustedProxyHops(), 0)];
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
