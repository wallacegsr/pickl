import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * URL admission control for CalDAV.
 *
 * This is the first place in the codebase where a **user-supplied URL is
 * fetched by the server**, which makes SSRF a real and new risk: without
 * a guard, anyone with an account could point the "server URL" field at
 * `http://169.254.169.254/…` (cloud instance metadata) or at another
 * service on the Docker network and use Pickl as a confused deputy — with
 * the response body and status surfacing straight back into the UI's
 * error text.
 *
 * Three rules, applied to the URL the user typed AND independently to
 * every redirect hop (see `davFetch` in ./caldavClient):
 *
 *  1. **https only.** CalDAV authenticates with HTTP Basic, i.e. the
 *     user's app password in a header on every request. Over http:// that
 *     is plaintext on the wire, so http:// is rejected outright. The one
 *     exception is a loopback host in a non-production build (see
 *     `isDevLoopback`), which is what makes a local Radicale/Baikal
 *     instance testable without minting certificates. It cannot be
 *     switched on in the shipped Docker image, where NODE_ENV=production —
 *     and that is deliberate: it needs no env var precisely so there is no
 *     knob an operator can flip by mistake.
 *
 *  2. **No embedded credentials.** `https://user:pass@host/` would put the
 *     password into every log line and error message we produce.
 *
 *  3. **Public destinations only.** Every address the hostname resolves to
 *     must be a global-unicast address. Loopback, link-local (including
 *     169.254.0.0/16 and fe80::/10), RFC1918, CGNAT, IPv6 ULA, and
 *     IPv4-mapped IPv6 forms of all of the above are refused. DNS is
 *     resolved here and the result checked, so a hostname that *points* at
 *     10.0.0.5 is caught as surely as the literal.
 *
 * Note the residual TOCTOU: we resolve, validate, then let `fetch` resolve
 * again. Closing that properly means pinning the socket to the validated
 * address (a custom agent/`lookup`), which undici does not expose through
 * `fetch`. The remaining attack needs control of a DNS server answering
 * with a public address and then a private one within the same second, to
 * reach a host on the app's own network with a request it cannot read the
 * response of unless it also controls that host. Documented rather than
 * silently ignored; the honest fix is a network policy on the container.
 */

export class CaldavUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaldavUrlError";
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * True for a loopback host in a non-production build. The only case where
 * a plain-http CalDAV URL is accepted: nothing leaves the machine, so
 * there is no wire for the Basic credentials to leak onto.
 */
export function isDevLoopback(hostname: string): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => Number(p));
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
  return octets;
}

function isPrivateIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (!octets) return true; // Unparseable: refuse rather than guess.
  const [a, b] = octets;
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (RFC6598)
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function isPrivateIpv6(address: string): boolean {
  const addr = address.toLowerCase().split("%")[0]; // drop any zone id
  // IPv4-mapped / -compatible: judge by the embedded v4 address.
  const mapped = addr.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  if (addr === "::" || addr === "::1") return true;
  if (addr.startsWith("fe8") || addr.startsWith("fe9")) return true; // fe80::/10
  if (addr.startsWith("fea") || addr.startsWith("feb")) return true;
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // ULA fc00::/7
  if (addr.startsWith("ff")) return true; // multicast
  return false;
}

function isPrivateAddress(address: string, family: number): boolean {
  return family === 4 ? isPrivateIpv4(address) : isPrivateIpv6(address);
}

/**
 * Validates the *shape* of a CalDAV URL without touching the network.
 * Returns the normalized URL. Throws `CaldavUrlError` with a message meant
 * for the user.
 */
export function normalizeCaldavUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) throw new CaldavUrlError("Enter your CalDAV server URL.");

  let url: URL;
  try {
    // Bare hostnames are common in these fields; assume https, never http.
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new CaldavUrlError("That doesn't look like a valid URL.");
  }

  if (url.username || url.password) {
    throw new CaldavUrlError(
      "Remove the username and password from the URL — enter them in the fields below instead."
    );
  }

  if (url.protocol === "http:") {
    if (!isDevLoopback(url.hostname)) {
      throw new CaldavUrlError(
        "CalDAV sends your password with every request, so the server URL must start with https://."
      );
    }
  } else if (url.protocol !== "https:") {
    throw new CaldavUrlError("The server URL must start with https://.");
  }

  if (!url.hostname) throw new CaldavUrlError("The server URL is missing a hostname.");
  url.hash = "";
  return url;
}

/**
 * Full check: shape, then where the hostname actually points. Async
 * because it resolves DNS. Every request in ./caldavClient goes through
 * this, including redirect targets.
 */
export async function assertCaldavUrlAllowed(url: URL): Promise<void> {
  // Re-run the shape rules; a redirect Location is untrusted input too.
  const normalized = normalizeCaldavUrl(url.toString());

  const hostname = normalized.hostname.replace(/^\[|\]$/g, "");

  // The dev loopback exception is the one place a private address is fine.
  if (isDevLoopback(normalized.hostname) || isDevLoopback(hostname)) return;

  const literalFamily = isIP(hostname);
  if (literalFamily) {
    if (isPrivateAddress(hostname, literalFamily)) {
      throw new CaldavUrlError(
        "That address is on a private or internal network, which Pickl won't connect to."
      );
    }
    return;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new CaldavUrlError(
      `Could not resolve "${hostname}" — check the server address.`
    );
  }
  if (addresses.length === 0) {
    throw new CaldavUrlError(`Could not resolve "${hostname}".`);
  }
  // Every answer must be public: one private address is enough to refuse,
  // since we cannot control which one `fetch` picks.
  for (const { address, family } of addresses) {
    if (isPrivateAddress(address, family)) {
      throw new CaldavUrlError(
        `"${hostname}" resolves to a private or internal address, which Pickl won't connect to.`
      );
    }
  }
}
