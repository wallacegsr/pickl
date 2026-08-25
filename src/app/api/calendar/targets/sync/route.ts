import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logAuditEntry } from "@/lib/audit";
import { getTargetForUserScope } from "@/lib/calendar/accounts";
import { resyncWeek } from "@/lib/calendar/sync";
import { todayDateString } from "@/lib/dates";
import { calendarSyncNowSchema } from "@/lib/validators";

/**
 * "Sync now" — reconciles one week for ONE of the caller's own targets.
 * The recovery path when a detached background push failed.
 *
 * The target is looked up by (session user id, scope), so it is
 * structurally impossible to sync someone else's target: no target id is
 * accepted from the client at all.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await req.json().catch(() => null);
  const parsed = calendarSyncNowSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const target = getTargetForUserScope(userId, parsed.data.scope);
  if (!target) {
    return NextResponse.json(
      { error: "No calendar is selected for that plan." },
      { status: 404 }
    );
  }

  const week = parsed.data.week || todayDateString();
  const result = await resyncWeek(target, week);

  logAuditEntry({
    userId,
    targetUserId: userId,
    action: "calendar_resync",
    scope: parsed.data.scope,
    date: week,
    notes: `manual sync (created=${result.created}, updated=${result.updated}, deleted=${result.deleted}, skipped=${result.skipped}, error=${result.error ? "yes" : "no"})`,
  });

  if (result.error) {
    return NextResponse.json({ ...result }, { status: 502 });
  }
  return NextResponse.json(result);
}
