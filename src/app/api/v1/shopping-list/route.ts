import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiJson, apiPlanContext, isRealDate, withApi } from "@/lib/api/v1";
import { extraItemId, shoppingItems } from "@/lib/api/serialize";
import { householdToday } from "@/lib/householdTime";
import { suspensionError } from "@/lib/households";
import { buildShoppingListWeek } from "@/lib/shoppingList";
import { addExtra, listExtras, MAX_EXTRA_LENGTH, weekKey } from "@/lib/shoppingExtras";

/**
 * The week's shopping list: every ingredient line from the planned recipes,
 * then the extras added by hand. `to_buy` is what is not yet on hand — the
 * number for a sensor.
 */
export function GET(req: NextRequest) {
  return withApi(req, "read", (principal) => {
    const params = req.nextUrl.searchParams;
    const resolved = apiPlanContext(principal, params.get("scope"), "read");
    if (!resolved.ok) return apiError(resolved.status, resolved.error);
    const context = resolved.context;

    const date = params.get("date") || householdToday(context.householdId);
    if (!isRealDate(date)) return apiError(400, "date must be YYYY-MM-DD.");

    const days = buildShoppingListWeek(context.householdId, date, context.scope, context.userId);
    const items = shoppingItems(days, listExtras(context, date));
    return apiJson({
      week_start: weekKey(date),
      scope: context.scope,
      to_buy: items.filter((i) => !i.on_hand).length,
      total: items.length,
      items,
    });
  });
}

const addSchema = z.object({
  text: z.string().trim().min(1, "text is required.").max(MAX_EXTRA_LENGTH),
  date: z.string().refine(isRealDate, "date must be YYYY-MM-DD.").optional(),
  scope: z.enum(["shared", "private"]).optional(),
});

/** Adds something to buy that no recipe asked for — "add milk to the list". */
export function POST(req: NextRequest) {
  return withApi(req, "write", async (principal) => {
    const parsed = addSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "Invalid input.");

    // A checklist change, not a plan edit: anyone who can see the list may add
    // to it, as in the browser — but not while the household is suspended.
    const resolved = apiPlanContext(principal, parsed.data.scope, "read");
    if (!resolved.ok) return apiError(resolved.status, resolved.error);
    const suspended = suspensionError(resolved.context.householdId);
    if (suspended) return apiError(suspended.status, suspended.error);

    const date = parsed.data.date ?? householdToday(resolved.context.householdId);
    const result = addExtra(resolved.context, date, parsed.data.text, principal.user.id);
    if (!result.ok) return apiError(result.status, result.error);

    return apiJson(
      {
        id: extraItemId(result.item.id),
        text: result.item.text,
        on_hand: false,
        source: "extra",
        week_start: weekKey(date),
      },
      201
    );
  });
}
