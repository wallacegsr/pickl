import { getRecipePool, getWeekPlan, lastPlannedByRecipe, MEAL_TYPE_LIST } from "@/lib/plan";
import { favoriteRecipeIds } from "@/lib/favorites";
import { pickerChipsFor } from "@/lib/pickerChips";
import { buildShoppingListWeek } from "@/lib/shoppingList";
import { viewerToday } from "@/lib/viewerToday";
import { auth } from "@/lib/auth";
import { canEditSharedCalendar, householdScope, isAdmin } from "@/lib/permissions";
import { resolvePlanContext } from "@/lib/planContext";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type MealType } from "@/db/schema";
import PlanView, { type RecipeOption } from "@/components/PlanView";
import { isOverlayEnabledForUser } from "@/lib/calendar/read";
import { getDashboardLayout } from "@/lib/dashboard/store";
import { getTagsForRecipes } from "@/lib/tags";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function PlanPage(
  props: {
    searchParams: Promise<{ week?: string; scope?: string; userId?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const today = (await viewerToday());
  const week = searchParams.week || today;

  // Handled before the resolver, and NOT with a redirect. A platform operator
  // belongs to no household, so no query string gets them a calendar —
  // redirecting them to a different one just brings them back here, which is
  // a loop rather than an answer.
  if (!householdScope(session.user)) {
    return (
      <div>
        <h2 className="mb-3">No household</h2>
        <p className="text-muted" style={{ maxWidth: "34rem" }}>
          This account administers the deployment rather than belonging to a
          family, so it has no meal plan of its own. Households and their
          settings are under{" "}
          <Link href="/admin">Back of House</Link>.
        </p>
      </div>
    );
  }

  // The same resolver the plan API uses, rather than a second copy of the
  // rules here. It authorizes the scope, and — since a household admin may
  // name another user — checks that user is in the viewer's own household.
  const resolved = resolvePlanContext(
    session.user,
    searchParams.scope,
    searchParams.userId,
    "read"
  );
  if (!resolved.ok) {
    // Back to the plain shared calendar, but only from a query string that
    // asked for something else. A bare /plan has nowhere to redirect to, so
    // it says so instead of redirecting to itself forever.
    if (searchParams.scope || searchParams.userId) redirect("/plan");
    return (
      <div>
        <h2 className="mb-3">The Menu</h2>
        <p className="text-muted">{resolved.error}</p>
      </div>
    );
  }
  const { householdId, scope } = resolved.context;
  const requestedUserId = searchParams.userId || session.user.id;

  const effectiveUserId = resolved.context.userId;
  const days = getWeekPlan(householdId, week, scope, effectiveUserId);
  const shoppingListDays = buildShoppingListWeek(householdId, week, scope, effectiveUserId);

  // Recipe pool for the manual editor: union across all meal types eligible
  // for this calendar; PlanView filters further by the specific slot's meal.
  const poolsByMeal = MEAL_TYPE_LIST.map(
    (mt) =>
      [mt, getRecipePool(householdId, scope, effectiveUserId, mt)] as const
  );
  // One tag lookup for the union of all three pools — never one per recipe.
  const poolTags = getTagsForRecipes(householdId, [
    ...new Set(poolsByMeal.flatMap(([, pool]) => pool.map((r) => r.id))),
  ]);
  // The picker shows a star, when a recipe was last cooked and how long it
  // takes, so those come along with the pool rather than being fetched per row.
  const favorites = favoriteRecipeIds(session.user, householdId);
  const lastPlanned = lastPlannedByRecipe(householdId, scope, effectiveUserId);
  // Each recipe is sent ONCE, with the meal pools as lists of ids. It used to
  // go out in full per meal it suited — an "any meal" recipe three times — and
  // with its whole ingredient list every time, which on a real jar of scraped
  // recipes made this page megabytes. Ingredient text now comes only for the
  // recipes planned this week (the quick look shows those); the picker asks
  // the server when it needs to search ingredients.
  const plannedIds = new Set(
    days.flatMap((d) => Object.values(d.meals).flatMap((m) => m.recipes.map((r) => r.recipe.id)))
  );
  const recipeById = new Map<string, RecipeOption>();
  for (const [meal, pool] of poolsByMeal) {
    for (const r of pool) {
      const seen = recipeById.get(r.id);
      if (seen) {
        seen.pools.push(meal);
        continue;
      }
      recipeById.set(r.id, {
        pools: [meal],
        id: r.id,
        name: r.name,
        tags: poolTags.get(r.id) ?? [],
        ingredients: plannedIds.has(r.id) ? r.ingredients : "",
        mealType: r.mealType,
        isFavorite: favorites.has(r.id),
        lastPlanned: lastPlanned.get(r.id) ?? null,
        totalMinutes:
          r.prepTimeMinutes == null && r.cookTimeMinutes == null
            ? null
            : (r.prepTimeMinutes ?? 0) + (r.cookTimeMinutes ?? 0),
      });
    }
  }

  // Chips for the slot picker: the person's own choice, or the household's
  // most-used tags when they have not chosen.
  const pickerChips = pickerChipsFor(session.user, householdId);

  const admin = isAdmin(session.user);
  const householdUsers = admin
    ? db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        // This household's members only. An admin administers their own
        // family, not everyone on the deployment.
        .where(eq(users.householdId, householdId))
        .all()
    : [];

  // The viewer's OWN dashboard arrangement, keyed on the session user and
  // nothing else — never `requestedUserId`. Whose plan is on screen has no
  // bearing on whose widget layout is loaded, and there is no path by which
  // one user can read another's. Already reconciled against the current
  // widget registry, so a layout saved by an older release still renders.
  const dashboardLayout = getDashboardLayout(session.user.id);

  return (
    <div>
      <PlanView
        week={week}
        // Today where the viewer is, decided once on the server and used by
        // the browser as-is, so both draw the same days.
        today={today}
        scope={scope}
        targetUserId={effectiveUserId}
        requestedUserId={requestedUserId}
        initialDays={days}
        shoppingListDays={shoppingListDays}
        dashboardLayout={dashboardLayout}
        recipes={[...recipeById.values()]}
        pickerChips={pickerChips}
        canEditShared={canEditSharedCalendar(session.user)}
        isAdmin={admin}
        currentUserId={session.user.id}
        householdUsers={householdUsers}
        // Only the viewer's OWN opt-in, read from their own row. Note what
        // this deliberately is not: any function of `requestedUserId`.
        // Whose plan is on screen never unlocks anybody's calendar.
        overlayEnabled={isOverlayEnabledForUser(session.user.id)}
      />
    </div>
  );
}
