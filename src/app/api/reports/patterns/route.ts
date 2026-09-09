import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { getPatternsReport } from "@/lib/reports";
import type { MealType, Scope } from "@/db/schema";

/**
 * The Patterns report: coverage, cook time by weekday, tag mix, desserts and
 * who plans, from one pass over the same filtered history the other reports
 * use.
 *
 * No CSV export. Every other report is a list of rows that means something in
 * a spreadsheet; this one is five different shapes at once, and flattening
 * them into a single CSV would produce a file nobody could use.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const startDate = sp.get("startDate") || undefined;
  const endDate = sp.get("endDate") || undefined;
  const scope = (sp.get("scope") as Scope | null) || undefined;
  const mealType = (sp.get("mealType") as MealType | null) || undefined;
  const userId = isAdmin(session.user) ? sp.get("userId") || undefined : undefined;
  const tag = sp.get("tag") || undefined;

  return NextResponse.json(
    getPatternsReport(session.user, {
      startDate,
      endDate,
      scope,
      mealType,
      userId,
      tag,
    })
  );
}
