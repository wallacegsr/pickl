import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { todayDateString } from "@/lib/dates";
import { buildShoppingListWeek } from "@/lib/shoppingList";
import { resolvePlanContext } from "@/lib/planContext";
import {
  buildShoppingListCsv,
  buildShoppingListText,
  shoppingListFilename,
} from "@/lib/shoppingListExport";

/**
 * Server-rendered shopping list download.
 *
 * The panel already builds this file in the browser with `Blob` +
 * `URL.createObjectURL`, which works fine in a desktop browser but is a dead
 * end inside an Android WebView: a `blob:` URL never reaches the host app's
 * DownloadListener, so the button does nothing. Serving the same bytes from a
 * real URL with Content-Disposition lets the shell hand it to Android's
 * DownloadManager like any other file.
 *
 * The formatting is not reimplemented -- this shares the exact builders the
 * client uses, so the two paths cannot drift apart.
 *
 * Read access only, matching GET /api/shopping-list: exporting a checklist
 * discloses nothing the panel does not already show.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  const week = params.get("week") || todayDateString();

  const modeParam = params.get("mode") || "week";
  if (modeParam !== "today" && modeParam !== "week") {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }

  const formatParam = params.get("format") || "txt";
  if (formatParam !== "txt" && formatParam !== "csv") {
    return NextResponse.json({ error: "Invalid format" }, { status: 400 });
  }

  const resolved = resolvePlanContext(
    session.user,
    params.get("scope"),
    params.get("userId"),
    "read"
  );
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const allDays = buildShoppingListWeek(
    week,
    resolved.context.scope,
    resolved.context.userId
  );

  // Mirrors the panel's `visibleDays`: "today" narrows to the current date,
  // and falls back to an empty list when today is outside the requested week.
  const today = todayDateString();
  const days =
    modeParam === "today" ? allDays.filter((day) => day.date === today) : allDays;

  const body =
    formatParam === "csv" ? buildShoppingListCsv(days) : buildShoppingListText(days);
  const mime = formatParam === "csv" ? "text/csv" : "text/plain";
  const filename = shoppingListFilename(week, modeParam, formatParam);

  return new NextResponse(body, {
    headers: {
      "Content-Type": `${mime}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
