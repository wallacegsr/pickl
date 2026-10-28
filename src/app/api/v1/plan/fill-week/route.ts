import { NextRequest } from "next/server";
import { z } from "zod";
import { MEAL_TYPES } from "@/db/schema";
import { apiError, apiJson, apiPlanContext, auditNote, withApi } from "@/lib/api/v1";
import { householdToday } from "@/lib/householdTime";
import { spinWeek } from "@/lib/spin";

const schema = z.object({
  /** Which meals to fill. Dinner when not given. */
  meal_types: z.array(z.enum(MEAL_TYPES)).min(1).max(3).default(["dinner"]),
  include_dessert: z.boolean().default(false),
  tags: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  tag_match: z.enum(["any", "all"]).default("all"),
  favorites_only: z.boolean().default(false),
  /** Replace days already planned too. Off by default: only empty slots are filled. */
  overwrite: z.boolean().default(false),
  scope: z.enum(["shared", "private"]).optional(),
});

/** Weekly Picks: fills the rest of this week, today included, as the Plan page does. */
export function POST(req: NextRequest) {
  return withApi(req, "write", async (principal) => {
    const parsed = schema.safeParse((await req.json().catch(() => ({}))) ?? {});
    if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "Invalid input.");
    const input = parsed.data;

    const resolved = apiPlanContext(principal, input.scope, "write");
    if (!resolved.ok) return apiError(resolved.status, resolved.error);

    const result = spinWeek({
      user: principal.user,
      context: resolved.context,
      today: householdToday(resolved.context.householdId),
      mealTypes: input.meal_types,
      includeDessert: input.include_dessert,
      filter: { tags: input.tags, tagMatch: input.tag_match, favoritesOnly: input.favorites_only },
      overwriteExisting: input.overwrite,
      auditNotes: auditNote(principal),
    });

    const filled = result.filledDates.length;
    return apiJson({
      filled,
      unfilled: result.unfilledCount,
      message:
        filled === 0 && result.unfilledCount === 0
          ? "Nothing to fill — the rest of the week is already planned."
          : `Planned ${filled} meal${filled === 1 ? "" : "s"}${
              result.unfilledCount ? `; ${result.unfilledCount} left empty` : ""
            }.`,
      filled_slots: result.filledDates.map((f) => ({ date: f.date, meal_type: f.mealType })),
      note: result.note,
    });
  });
}
