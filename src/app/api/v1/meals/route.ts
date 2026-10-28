import { NextRequest } from "next/server";
import { apiError, apiJson, apiPlanContext, isRealDate, withApi } from "@/lib/api/v1";
import { dayMeals, slotTitle } from "@/lib/api/serialize";
import { householdToday } from "@/lib/householdTime";
import { getWeekPlan } from "@/lib/plan";

/**
 * One day's meals — today unless `?date=` says otherwise.
 *
 * `breakfast`, `lunch` and `dinner` at the top level are the slot's title
 * ("Tomato Soup", or "Chilli & Brownies" for two recipes), so a sensor can
 * use one directly as its state; `meals` has every recipe in full.
 */
export function GET(req: NextRequest) {
  return withApi(req, "read", (principal) => {
    const params = req.nextUrl.searchParams;
    const resolved = apiPlanContext(principal, params.get("scope"), "read");
    if (!resolved.ok) return apiError(resolved.status, resolved.error);
    const { householdId, scope, userId } = resolved.context;

    const today = householdToday(householdId);
    const date = params.get("date") || today;
    if (!isRealDate(date)) return apiError(400, "date must be YYYY-MM-DD.");

    const day = getWeekPlan(householdId, date, scope, userId).find((d) => d.date === date)!;
    const meals = dayMeals(day);

    return apiJson({
      date,
      day_of_week: day.dayOfWeek,
      is_today: date === today,
      scope,
      breakfast: slotTitle(meals.breakfast),
      lunch: slotTitle(meals.lunch),
      dinner: slotTitle(meals.dinner),
      meals,
    });
  });
}
