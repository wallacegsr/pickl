import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logAuditEntry } from "@/lib/audit";
import {
  isOverlayEnabledForUser,
  setOverlayEnabledForUser,
} from "@/lib/calendar/read";
import { calendarOverlaySchema } from "@/lib/validators";

/**
 * The read-back overlay opt-in, for the signed-in user only.
 *
 * Self-service, like every other route under /api/preferences and
 * /api/calendar: the user id comes from the session and is never accepted
 * from the client, so there is no way for one person (admin included) to
 * switch reading on for somebody else.
 *
 * The audit note records that the switch moved and in which direction —
 * turning calendar reading on is worth a trail — and nothing else. No
 * calendar id, and obviously no event data, which this route never sees.
 */
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await req.json().catch(() => null);
  const parsed = calendarOverlaySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const enabled = parsed.data.enabled;
  if (isOverlayEnabledForUser(userId) !== enabled) {
    setOverlayEnabledForUser(userId, enabled);
    logAuditEntry({
      userId,
      targetUserId: userId,
      action: "calendar_update",
      notes: `calendar event overlay turned ${enabled ? "on" : "off"}`,
    });
  }

  return NextResponse.json({ enabled });
}
