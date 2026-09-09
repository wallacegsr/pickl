import { NextRequest, NextResponse } from "next/server";
import ical, { ICalEventStatus } from "ical-generator";
import { auth } from "@/lib/auth";
import { getWeekPlan, MEAL_TYPE_LIST } from "@/lib/plan";
import { parseDateString, todayDateString, MEAL_DEFAULT_HOUR, MEAL_LABELS } from "@/lib/dates";
import { resolvePlanContext } from "@/lib/planContext";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const week = req.nextUrl.searchParams.get("week") || todayDateString();
  const scopeParam = req.nextUrl.searchParams.get("scope");
  const targetUserId = req.nextUrl.searchParams.get("userId");

  const resolved = resolvePlanContext(session.user, scopeParam, targetUserId, "read");
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const plan = getWeekPlan(
    resolved.context.householdId,
    week,
    resolved.context.scope,
    resolved.context.userId
  );

  const calendar = ical({ name: "Pickl" });

  for (const day of plan) {
    for (const mealType of MEAL_TYPE_LIST) {
      const slot = day.meals[mealType];

      // One event per recipe. A two-recipe dinner becomes two events at the
      // same hour rather than one merged event, so each keeps its own
      // ingredients and instructions in the description where they are
      // actually useful.
      for (const { recipe } of slot.recipes) {
        const baseDate = parseDateString(day.date);
        const start = new Date(baseDate);
        start.setHours(MEAL_DEFAULT_HOUR[mealType] ?? 18, 0, 0, 0);
        const end = new Date(start);
        end.setHours(start.getHours() + 1);

        const ingredientsPreview = recipe.ingredients
          .split("\n")
          .filter(Boolean)
          .slice(0, 10)
          .join(", ");

        calendar.createEvent({
          start,
          end,
          summary: `${MEAL_LABELS[mealType]}: ${recipe.name}`,
          description: [
            ingredientsPreview ? `Ingredients: ${ingredientsPreview}` : null,
            recipe.instructions
              ? `Instructions: ${recipe.instructions.slice(0, 500)}`
              : null,
          ]
            .filter(Boolean)
            .join("\n\n"),
          status: ICalEventStatus.CONFIRMED,
        });
      }
    }
  }

  const icsContent = calendar.toString();

  return new NextResponse(icsContent, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="pickl-plan-${week}.ics"`,
    },
  });
}
