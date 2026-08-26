import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getWeekPlan, MEAL_TYPE_LIST } from "@/lib/plan";
import { todayDateString } from "@/lib/dates";
import { resolvePlanContext } from "@/lib/planContext";
import { getTagsForRecipes } from "@/lib/tags";

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

  const plan = getWeekPlan(week, resolved.context.scope, resolved.context.userId);

  // Tags for every recipe in the week, in one query rather than per slot.
  const plannedRecipeIds = [
    ...new Set(
      plan.flatMap((day) =>
        MEAL_TYPE_LIST.map((mealType) => day.meals[mealType].recipe?.id).filter(
          (id): id is string => Boolean(id)
        )
      )
    ),
  ];
  const tagsByRecipe = getTagsForRecipes(plannedRecipeIds);

  const payload = plan.map((day) => ({
    date: day.date,
    dayOfWeek: day.dayOfWeek,
    meals: Object.fromEntries(
      MEAL_TYPE_LIST.map((mealType) => {
        const slot = day.meals[mealType];
        return [
          mealType,
          slot.recipe
            ? {
                id: slot.recipe.id,
                name: slot.recipe.name,
                ingredients: slot.recipe.ingredients,
                instructions: slot.recipe.instructions,
                prepTimeMinutes: slot.recipe.prepTimeMinutes,
                cookTimeMinutes: slot.recipe.cookTimeMinutes,
                servings: slot.recipe.servings,
                // An array of tag names now, rather than the old
                // comma-separated string.
                tags: tagsByRecipe.get(slot.recipe.id) ?? [],
              }
            : null,
        ];
      })
    ),
  }));

  return NextResponse.json(payload, {
    headers: {
      "Content-Disposition": `attachment; filename="dinner-plan-${week}.json"`,
    },
  });
}
