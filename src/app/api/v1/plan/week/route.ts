import { NextRequest } from "next/server";
import { apiError, apiJson, apiPlanContext, isRealDate, withApi } from "@/lib/api/v1";
import { dayMeals, slotTitle } from "@/lib/api/serialize";
import { householdToday } from "@/lib/householdTime";
import { getWeekPlan, MEAL_TYPE_LIST } from "@/lib/plan";
import type { MealType } from "@/db/schema";

/**
 * The Sunday-to-Saturday week containing `?date=` (default today), plus how
 * many slots from today on are still empty — the number a "plan the week"
 * reminder wants.
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

    const week = getWeekPlan(householdId, date, scope, userId);
    const unplanned = Object.fromEntries(MEAL_TYPE_LIST.map((m) => [m, 0])) as Record<MealType, number>;

    const days = week.map((day) => {
      const meals = dayMeals(day);
      // Days before today are history; an empty one there is not a gap to fill.
      if (day.date >= today) {
        for (const mealType of MEAL_TYPE_LIST) {
          if (meals[mealType].length === 0) unplanned[mealType]++;
        }
      }
      return {
        date: day.date,
        day_of_week: day.dayOfWeek,
        is_past: day.date < today,
        is_today: day.date === today,
        breakfast: slotTitle(meals.breakfast),
        lunch: slotTitle(meals.lunch),
        dinner: slotTitle(meals.dinner),
        meals,
      };
    });

    return apiJson({
      week_start: week[0].date,
      week_end: week[week.length - 1].date,
      today,
      scope,
      unplanned_remaining: unplanned,
      days,
    });
  });
}
