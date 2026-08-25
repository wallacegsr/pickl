import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { dashboardLayoutSchema } from "@/lib/validators";
import {
  getDashboardLayout,
  resetDashboardLayout,
  saveDashboardLayout,
} from "@/lib/dashboard/store";
import { reconcileLayout } from "@/lib/dashboard/widgets";

/**
 * The signed-in user's /plan dashboard arrangement.
 *
 * Authorization is the whole story here and it is a short one: the owner is
 * `session.user.id` on every verb, and nothing in the request — body, query
 * string or header — can name a different user. There is no admin override
 * and no cross-user read, so a caller passing `?userId=...` or
 * `{"userId": "..."}` gets their own layout back, not somebody else's; the
 * parameter is simply never read.
 *
 * Everything that comes back has been through reconcileLayout, so a client
 * can never be handed a layout referencing a widget that no longer exists.
 */

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    { layout: getDashboardLayout(session.user.id) },
    { headers: { "Cache-Control": "no-store, private" } }
  );
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = dashboardLayoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid layout" }, { status: 400 });
  }

  // Reconcile before storing, not just on read: it keeps unknown widget ids
  // and out-of-range geometry out of the table in the first place.
  const layout = reconcileLayout(parsed.data);
  return NextResponse.json({
    layout: saveDashboardLayout(session.user.id, layout),
  });
}

/** Reset to the shipped default arrangement. */
export async function DELETE() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ layout: resetDashboardLayout(session.user.id) });
}
