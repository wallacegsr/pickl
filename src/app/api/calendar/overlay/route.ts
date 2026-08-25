import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getOverlayEvents } from "@/lib/calendar/read";
import { todayDateString } from "@/lib/dates";
import type { Scope } from "@/db/schema";

/**
 * The signed-in user's OWN external calendar events for one week, for the
 * plan grid's overlay.
 *
 * Three things to notice about the parameters:
 *
 *  - There is no `userId` input that could select whose *calendar* is
 *    read. The viewer is the session user, full stop. `userId` below names
 *    whose *plan* is on screen, and is used only to decide whether an
 *    overlay is shown at all.
 *  - An admin asking for a member's private plan gets `not-available` and
 *    an empty list, same as anyone else would. That rule lives in
 *    src/lib/calendar/read.ts so it cannot be skipped by a second caller.
 *  - Nothing returned here is stored. It is fetched, filtered, serialized
 *    and forgotten.
 *
 * Always 200 (except for an unauthenticated caller). The client treats a
 * failure as "no overlay", never as a page error, so there is no status
 * code here that could tempt it into doing otherwise.
 */

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const week = req.nextUrl.searchParams.get("week") || todayDateString();
  const scope: Scope =
    req.nextUrl.searchParams.get("scope") === "private" ? "private" : "shared";
  const planOwnerUserId =
    req.nextUrl.searchParams.get("userId") || session.user.id;

  const result = await getOverlayEvents({
    viewerUserId: session.user.id,
    scope,
    planOwnerUserId,
    week,
  });

  return NextResponse.json(result, {
    // Transient, per-viewer, private data: it must never be held by a
    // shared cache or a CDN. The 60-second reuse window lives in-process
    // (see read.ts), where it is keyed by user and cannot be served across
    // sessions.
    headers: { "Cache-Control": "no-store, private" },
  });
}
