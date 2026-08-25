import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRecipeFrequency, toCsv } from "@/lib/reports";
import { isAdmin } from "@/lib/permissions";
import type { MealType, Scope } from "@/db/schema";

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
  const format = sp.get("format");

  const rows = getRecipeFrequency(session.user, { startDate, endDate, scope, mealType, userId });

  if (format === "csv") {
    const csv = toCsv(["recipeName", "scope", "count"], rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="recipe-frequency.csv"`,
      },
    });
  }

  return NextResponse.json(rows);
}
