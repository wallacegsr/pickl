import { NextResponse } from "next/server";
import pkg from "../../../../package.json";

/**
 * Unauthenticated liveness/identity probe.
 *
 * This exists for the Android shell's "connect to server" screen, which has to
 * tell three failures apart before the user has any session at all:
 *
 *   - the host is unreachable       -> the fetch itself rejects
 *   - the host answers but is not Pickl (a router page, a NAS login, some
 *     other container on the same reverse proxy) -> 200 with the wrong body
 *   - the host is Pickl             -> 200 with `app: "pickl"`
 *
 * Probing `/login` (as the Docker healthcheck does) cannot make the middle
 * distinction: almost anything returns a 200 HTML page.
 *
 * Deliberately anonymous, because it is fetched before login. It therefore
 * reports only what an unauthenticated visitor could already infer from the
 * login page: that this is Pickl, and which version. No user counts, no setup
 * state, no configuration -- those would be a genuine disclosure on an
 * internet-facing host.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { app: "pickl", version: pkg.version },
    // A stale cached probe would report a server that has since moved or gone
    // down as healthy.
    { headers: { "Cache-Control": "no-store" } }
  );
}
