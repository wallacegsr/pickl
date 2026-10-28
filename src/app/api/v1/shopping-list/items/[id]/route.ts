import { NextRequest } from "next/server";
import { z } from "zod";
import type { ApiPrincipal } from "@/lib/apiTokens";
import { apiError, apiJson, apiPlanContext, isRealDate, withApi } from "@/lib/api/v1";
import { lineItemId } from "@/lib/api/serialize";
import { suspensionError } from "@/lib/households";
import type { PlanContext } from "@/lib/planContext";
import { buildShoppingListWeek, setOnHand } from "@/lib/shoppingList";
import { deleteExtra, setExtraOnHand } from "@/lib/shoppingExtras";

/**
 * One shopping-list item, by the id GET /api/v1/shopping-list gave it:
 * `r_<date>_<hash>` for a line from a planned recipe, `x_<id>` for an extra.
 *
 * The calendar comes from `?scope=` (shared unless "private"), never from the
 * id — so an id copied from somewhere else still only reaches this caller's
 * own lists.
 */

type Params = { params: Promise<{ id: string }> };

/** The calendar to act on, refused when the household is suspended. */
function writableContext(principal: ApiPrincipal, req: NextRequest): PlanContext | Response {
  const resolved = apiPlanContext(principal, req.nextUrl.searchParams.get("scope"), "read");
  if (!resolved.ok) return apiError(resolved.status, resolved.error);
  const suspended = suspensionError(resolved.context.householdId);
  if (suspended) return apiError(suspended.status, suspended.error);
  return resolved.context;
}

const updateSchema = z.object({ on_hand: z.boolean() });

async function update(req: NextRequest, props: Params) {
  const { id } = await props.params;
  return withApi(req, "write", async (principal) => {
    const parsed = updateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return apiError(400, "Send { \"on_hand\": true } or { \"on_hand\": false }.");
    const onHand = parsed.data.on_hand;

    const context = writableContext(principal, req);
    if (context instanceof Response) return context;

    if (id.startsWith("x_")) {
      const item = setExtraOnHand(context, id.slice(2), onHand);
      if (!item) return apiError(404, "Item not found.");
      return apiJson({ id, text: item.text, on_hand: item.onHand, source: "extra" });
    }

    const match = id.match(/^r_(\d{4}-\d{2}-\d{2})_([A-Za-z0-9_-]{16})$/);
    if (!match || !isRealDate(match[1])) return apiError(404, "Item not found.");
    const date = match[1];

    // Rebuild the week and find the line, so only a line that is really on
    // this calendar's list can be ticked — never arbitrary text on any date.
    const days = buildShoppingListWeek(context.householdId, date, context.scope, context.userId);
    for (const meal of days.find((d) => d.date === date)?.meals ?? []) {
      for (const ing of meal.ingredients) {
        if (lineItemId(date, meal.mealType, meal.recipeId, ing.ingredientText) !== id) continue;
        setOnHand({
          householdId: context.householdId,
          scope: context.scope,
          userId: context.userId,
          date,
          mealType: meal.mealType,
          recipeId: meal.recipeId,
          ingredientText: ing.ingredientText,
          onHand,
          actingUserId: principal.user.id,
        });
        return apiJson({ id, text: ing.ingredientText, on_hand: onHand, source: "recipe" });
      }
    }
    return apiError(404, "Item not found.");
  });
}

/** `{ "on_hand": true }` ticks an item off; `false` puts it back on the list. */
export const POST = update;
export const PATCH = update;

/** Removes an extra. A recipe's line goes when the recipe leaves the plan; tick it off instead. */
export async function DELETE(req: NextRequest, props: Params) {
  const { id } = await props.params;
  return withApi(req, "write", (principal) => {
    if (!id.startsWith("x_")) {
      return apiError(400, "Only items added by hand can be removed. Tick a recipe's line off instead.");
    }
    const context = writableContext(principal, req);
    if (context instanceof Response) return context;
    if (!deleteExtra(context, id.slice(2))) return apiError(404, "Item not found.");
    return apiJson({ id, deleted: true });
  });
}
