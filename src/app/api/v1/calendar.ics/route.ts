import { NextRequest, NextResponse } from "next/server";
import ical, { ICalEventStatus } from "ical-generator";
import { apiError, apiPlanContext, withFeedKey } from "@/lib/api/v1";
import { recipeUrl } from "@/lib/api/serialize";
import { getSundayOfWeek, MEAL_DEFAULT_HOUR, MEAL_LABELS, toDateString } from "@/lib/dates";
import { householdTimeZone, householdToday, zonedTime } from "@/lib/householdTime";
import { getWeekPlan, MEAL_TYPE_LIST } from "@/lib/plan";
import { splitIngredients } from "@/lib/ingredients";

/** Weeks before and after the current one that the feed covers. */
const WEEKS_BACK = 1;
const WEEKS_AHEAD = 3;

/**
 * The plan as a subscribable calendar, for Home Assistant's Remote Calendar
 * (or any calendar app).
 *
 * Authenticated by a feed key in `?key=`, because a calendar subscription is
 * a bare URL with nowhere to put a header. A feed key opens this and nothing
 * else (see src/lib/api/v1.ts), since a URL ends up in logs and history.
 *
 * Each event's UID is its plan entry, so a subscriber sees an edit as the same
 * event moving rather than one vanishing and another appearing, and times are
 * the household's — 18:00 dinner means 18:00 where the household is, not on
 * the server's clock.
 */
export function GET(req: NextRequest) {
  return withFeedKey(req, (principal) => {
    const resolved = apiPlanContext(principal, req.nextUrl.searchParams.get("scope"), "read");
    if (!resolved.ok) return apiError(resolved.status, resolved.error);
    const { householdId, scope, userId } = resolved.context;

    const zone = householdTimeZone(householdId);
    const sunday = getSundayOfWeek(householdToday(householdId));

    const calendar = ical({
      name: scope === "private" ? `Pickl — ${principal.user.name}` : "Pickl",
      prodId: { company: "Pickl", product: "meal-plan" },
      // How often subscribers should look again. Meal plans change by the day,
      // not the minute.
      ttl: 60 * 60,
    });

    for (let offset = -WEEKS_BACK; offset <= WEEKS_AHEAD; offset++) {
      const ref = new Date(sunday);
      ref.setDate(sunday.getDate() + offset * 7);
      for (const day of getWeekPlan(householdId, toDateString(ref), scope, userId)) {
        for (const mealType of MEAL_TYPE_LIST) {
          // One event per recipe, so a main and a dessert each keep their own
          // ingredients in the description.
          for (const { entryId, recipe } of day.meals[mealType].recipes) {
            const start = zonedTime(day.date, MEAL_DEFAULT_HOUR[mealType] ?? 18, zone);
            const ingredients = splitIngredients(recipe.ingredients).slice(0, 15).join(", ");
            calendar.createEvent({
              id: `${entryId}@pickl`,
              start,
              end: new Date(start.getTime() + 60 * 60 * 1000),
              summary: `${MEAL_LABELS[mealType]}: ${recipe.name}`,
              description: ingredients ? `Ingredients: ${ingredients}` : null,
              url: recipeUrl(recipe.id),
              status: ICalEventStatus.CONFIRMED,
            });
          }
        }
      }
    }

    return new NextResponse(calendar.toString(), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  });
}
