import { getRecipePool, getWeekPlan, MEAL_TYPE_LIST } from "@/lib/plan";
import { buildShoppingListWeek } from "@/lib/shoppingList";
import { todayDateString } from "@/lib/dates";
import { auth } from "@/lib/auth";
import { canAccessPrivateCalendar, canEditSharedCalendar, isAdmin } from "@/lib/permissions";
import { db } from "@/db";
import { users, type MealType, type Scope } from "@/db/schema";
import PlanView, { type RecipeOption } from "@/components/PlanView";
import { isOverlayEnabledForUser } from "@/lib/calendar/read";
import { getDashboardLayout } from "@/lib/dashboard/store";
import { redirect } from "next/navigation";

export default async function PlanPage({
  searchParams,
}: {
  searchParams: { week?: string; scope?: string; userId?: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const week = searchParams.week || todayDateString();
  const scope: Scope = searchParams.scope === "private" ? "private" : "shared";
  const requestedUserId = searchParams.userId || session.user.id;

  if (scope === "private" && !canAccessPrivateCalendar(session.user, requestedUserId)) {
    redirect("/plan");
  }

  const effectiveUserId = scope === "private" ? requestedUserId : "";
  const days = getWeekPlan(week, scope, effectiveUserId);
  const shoppingListDays = buildShoppingListWeek(week, scope, effectiveUserId);

  // Recipe pool for the manual editor: union across all meal types eligible
  // for this calendar; PlanView filters further by the specific slot's meal.
  const poolByMeal = Object.fromEntries(
    MEAL_TYPE_LIST.map((mt) => [
      mt,
      getRecipePool(scope, scope === "private" ? requestedUserId : "", mt).map((r) => ({
        id: r.id,
        name: r.name,
        tags: r.tags,
        ingredients: r.ingredients,
      })),
    ])
  ) as Record<MealType, RecipeOption[]>;

  const admin = isAdmin(session.user);
  const householdUsers = admin
    ? db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
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
