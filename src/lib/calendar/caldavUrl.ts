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

/**
 * The eight 16-bit groups of an IPv6 address, or null if it isn't one.
 * Handles `::` and a trailing dotted IPv4 part (`::ffff:10.0.0.1`).
 */
function parseIpv6(address: string): number[] | null {
  let addr = address.toLowerCase().split("%")[0]; // drop any zone id
  const v4 = addr.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const o = parseIpv4(v4[2]);
    if (!o) return null;
    addr = `${v4[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/** Two 16-bit groups as a dotted IPv4 address. */
function ipv4From(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/**
 * Parsed rather than pattern-matched: URL and DNS both hand back IPv6 in
 * compressed hex, so `[::ffff:169.254.169.254]` arrives as `::ffff:a9fe:a9fe`,
 * which a dotted-quad pattern never sees. Any form that carries an IPv4
 * address inside it is judged by that IPv4 address.
 */
function isPrivateIpv6(address: string): boolean {
  const g = parseIpv6(address);
  if (!g) return true; // Unparseable: refuse rather than guess.

  const zeroUntil = (n: number) => g.slice(0, n).every((x) => x === 0);
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible, deprecated). This also
  // covers :: and ::1, whose "embedded" addresses are 0.0.0.0 and 0.0.0.1.
  if (zeroUntil(5) && (g[5] === 0xffff || g[5] === 0)) return isPrivateIpv4(ipv4From(g[6], g[7]));
  // ::ffff:0:a.b.c.d (IPv4-translated, RFC 2765).
  if (zeroUntil(4) && g[4] === 0xffff && g[5] === 0) return isPrivateIpv4(ipv4From(g[6], g[7]));
  // NAT64, well-known (64:ff9b::/96) and local-use (64:ff9b:1::/48) prefixes.
  if (g[0] === 0x64 && g[1] === 0xff9b) return g[2] !== 0 || isPrivateIpv4(ipv4From(g[6], g[7]));
  // 6to4 (2002::/16) carries the IPv4 address in the next 32 bits.
  if (g[0] === 0x2002) return isPrivateIpv4(ipv4From(g[1], g[2]));
  // Teredo (2001::/32) hides an obfuscated IPv4 address; no CalDAV host needs it.
  if (g[0] === 0x2001 && g[1] === 0) return true;
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard-only 100::/64
  if ((g[0] & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g[0] & 0xffc0) === 0xfec0) return true; // site-local fec0::/10 (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
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
