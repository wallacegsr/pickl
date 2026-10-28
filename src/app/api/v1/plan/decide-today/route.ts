import { NextRequest } from "next/server";
import { z } from "zod";
import { MEAL_TYPES } from "@/db/schema";
import { apiError, apiJson, apiPlanContext, auditNote, withApi } from "@/lib/api/v1";
import { householdToday } from "@/lib/householdTime";
import { spinToday } from "@/lib/spin";

const schema = z.object({
  /** One meal, or several with `meal_types`. Dinner when neither is given. */
  meal_type: z.enum(MEAL_TYPES).optional(),
  meal_types: z.array(z.enum(MEAL_TYPES)).min(1).max(3).optional(),
  include_dessert: z.boolean().default(false),
  tags: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  tag_match: z.enum(["any", "all"]).default("all"),
  favorites_only: z.boolean().default(false),
  /** Replace what is already planned. Off by default, so a button press never wipes a plan. */
  overwrite: z.boolean().default(false),
  scope: z.enum(["shared", "private"]).optional(),
});

/**
 * Crunch Time: picks today's meal, exactly as the Plan page's shake does.
 *
 * The answer names the pick, so an automation can say it out loud. If the
 * slot is already planned and `overwrite` is not set, nothing changes and the
 * 409 says what is there.
 */
export function POST(req: NextRequest) {
  return withApi(req, "write", async (principal) => {
    const parsed = schema.safeParse((await req.json().catch(() => ({}))) ?? {});
    if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "Invalid input.");
    const input = parsed.data;

    const resolved = apiPlanContext(principal, input.scope, "write");
    if (!resolved.ok) return apiError(resolved.status, resolved.error);

    const result = spinToday({
      user: principal.user,
      context: resolved.context,
      today: householdToday(resolved.context.householdId),
      mealTypes: input.meal_types ?? [input.meal_type ?? "dinner"],
      includeDessert: input.include_dessert,
      filter: { tags: input.tags, tagMatch: input.tag_match, favoritesOnly: input.favorites_only },
      force: input.overwrite,
      auditNotes: auditNote(principal),
    });

    if (result.kind === "conflict") {
      const planned = result.conflicts.map((c) => ({
        meal_type: c.mealType,
        recipes: c.currentRecipes.map((r) => r.name),
      }));
      const summary = planned.map((p) => `${p.meal_type}: ${p.recipes.join(" & ")}`).join("; ");
      return apiJson(
        {
          error: `Already planned (${summary}). Send "overwrite": true to replace it.`,
          planned,
        },
        409
      );
    }

    const picks = result.results.filter((r) => r.recipe);
    return apiJson({
      date: result.date,
      // One line for a notification or a speaker.
      message:
        picks.length > 0
          ? picks.map((r) => `${r.mealType}: ${r.recipe!.name}`).join(", ")
          : result.note ?? "Nothing could be picked.",
      results: result.results.map((r) => ({
        meal_type: r.mealType,
        recipe: r.recipe ? { id: r.recipe.id, name: r.recipe.name } : null,
      })),
      note: result.note,
    });
  });
}
