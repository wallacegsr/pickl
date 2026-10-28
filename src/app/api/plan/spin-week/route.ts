import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { viewerToday } from "@/lib/viewerToday";
import { spinWeekSchema } from "@/lib/validators";
import { resolvePlanContext } from "@/lib/planContext";
import { spinWeek } from "@/lib/spin";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = spinWeekSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }
  const {
    mealTypes,
    includeDessert,
    scope,
    userId,
    overwriteExisting,
    tags,
    tagMatch,
    favoritesOnly,
  } = parsed.data;

  const resolved = resolvePlanContext(session.user, scope, userId, "write");
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  return NextResponse.json(
    spinWeek({
      user: session.user,
      context: resolved.context,
      today: await viewerToday(),
      mealTypes,
      includeDessert,
      filter: { tags, tagMatch, favoritesOnly },
      overwriteExisting,
    })
  );
}
