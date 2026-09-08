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
        MEAL_TYPE_LIST.flatMap((mealType) =>
          day.meals[mealType].recipes.map((planned) => planned.recipe.id)
        )
      )
    ),
  ];
  const tagsByRecipe = getTagsForRecipes(plannedRecipeIds);

  const payload = plan.map((day) => ({
    date: day.date,
    dayOfWeek: day.dayOfWeek,
    meals: Object.fromEntries(
      // Each meal is now an ARRAY of recipes rather than one recipe or null,
      // because a slot can hold a main and a dessert, or two mains. An empty
      // array is the unplanned case that `null` used to represent.
      MEAL_TYPE_LIST.map((mealType) => {
        const slot = day.meals[mealType];
        return [
          mealType,
          slot.recipes.map(({ recipe }) => ({
            id: recipe.id,
            name: recipe.name,
            ingredients: recipe.ingredients,
            instructions: recipe.instructions,
            prepTimeMinutes: recipe.prepTimeMinutes,
            cookTimeMinutes: recipe.cookTimeMinutes,
            servings: recipe.servings,
            // An array of tag names now, rather than the old
            // comma-separated string.
            tags: tagsByRecipe.get(recipe.id) ?? [],
          })),
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
