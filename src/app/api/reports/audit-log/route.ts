import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAuditLogReport, toCsv } from "@/lib/reports";
import { isAdmin } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const startDate = sp.get("startDate") || undefined;
  const endDate = sp.get("endDate") || undefined;
  const action = sp.get("action") || undefined;
  const userId = isAdmin(session.user) ? sp.get("userId") || undefined : undefined;
  // Epoch milliseconds computed by the browser from the dates it showed, in
  // its own timezone. Parsed defensively: a junk value must fall back to the
  // date strings rather than silently filtering everything out.
  const asEpoch = (name: string) => {
    const raw = sp.get(name);
    if (raw === null) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };
  const startAt = asEpoch("startAt");
  const endBefore = asEpoch("endBefore");
  const planChangesOnly = sp.get("planChangesOnly") === "1";
  const format = sp.get("format");

  const rows = getAuditLogReport(session.user, {
    startDate,
    endDate,
    startAt,
    endBefore,
    action,
    userId,
    planChangesOnly,
  });

  if (format === "csv") {
    const csv = toCsv(
      [
        "timestamp",
        "userName",
        "action",
        "scope",
        "targetUserName",
        "date",
        "mealType",
        "oldRecipeName",
        "newRecipeName",
        "notes",
      ],
      rows
    );
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-log.csv"`,
      },
    });
  }

  return NextResponse.json(rows);
}
