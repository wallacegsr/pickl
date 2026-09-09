import { getRecipePool, getWeekPlan, MEAL_TYPE_LIST } from "@/lib/plan";
import { buildShoppingListWeek } from "@/lib/shoppingList";
import { todayDateString } from "@/lib/dates";
import { auth } from "@/lib/auth";
import { canEditSharedCalendar, isAdmin } from "@/lib/permissions";
import { resolvePlanContext } from "@/lib/planContext";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type MealType } from "@/db/schema";
import PlanView, { type RecipeOption } from "@/components/PlanView";
import { isOverlayEnabledForUser } from "@/lib/calendar/read";
import { getDashboardLayout } from "@/lib/dashboard/store";
import { getTagsForRecipes } from "@/lib/tags";
import { redirect } from "next/navigation";

export default async function PlanPage({
  searchParams,
}: {
  searchParams: { week?: string; scope?: string; userId?: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const week = searchParams.week || todayDateString();

  // The same resolver the plan API uses, rather than a second copy of the
  // rules here. It authorizes the scope, and — since a household admin may
  // name another user — checks that user is in the viewer's own household.
  const resolved = resolvePlanContext(
    session.user,
    searchParams.scope,
    searchParams.userId,
    "read"
  );
  if (!resolved.ok) redirect("/plan?scope=shared");
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
  const poolByMeal = Object.fromEntries(
    poolsByMeal.map(([mt, pool]) => [
      mt,
      pool.map((r) => ({
        id: r.id,
        name: r.name,
        tags: poolTags.get(r.id) ?? [],
        ingredients: r.ingredients,
      })),
    ])
  ) as Record<MealType, RecipeOption[]>;

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
        scope={scope}
        targetUserId={effectiveUserId}
        requestedUserId={requestedUserId}
        initialDays={days}
        shoppingListDays={shoppingListDays}
        dashboardLayout={dashboardLayout}
        recipePoolByMeal={poolByMeal}
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
