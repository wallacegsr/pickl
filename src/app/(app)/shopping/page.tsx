import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { householdScope } from "@/lib/permissions";
import { resolvePlanContext } from "@/lib/planContext";
import { buildShoppingListWeek } from "@/lib/shoppingList";
import { todayDateString } from "@/lib/dates";
import ShoppingListPanel from "@/components/ShoppingListPanel";

export const metadata = { title: "Shopping List · Pickl" };

/**
 * The shopping list on its own screen.
 *
 * It has lived as a dashboard widget on /plan, which is the right home for it
 * at a desk and the wrong one in a shop: the list you are reading while
 * holding a basket should not arrive under a week grid, three other widgets
 * and a page of scrolling. This route is the same panel with nothing above
 * it, and it is what the installed app's "Shopping list" shortcut opens.
 */
export default async function ShoppingPage({
  searchParams,
}: {
  searchParams: { week?: string; scope?: string; userId?: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const week = searchParams.week || todayDateString();

  if (!householdScope(session.user)) {
    return (
      <div>
        <h2 className="mb-3">Shopping List</h2>
        <p className="text-muted" style={{ maxWidth: "34rem" }}>
          This account administers the deployment rather than belonging to a
          family, so it has no shopping list. Households are under{" "}
          <Link href="/admin">Back of House</Link>.
        </p>
      </div>
    );
  }

  const resolved = resolvePlanContext(
    session.user,
    searchParams.scope,
    searchParams.userId,
    "read"
  );
  if (!resolved.ok) {
    // Same shape as /plan: only ever redirect away from a query string that
    // asked for something else, so a bare /shopping cannot loop.
    if (searchParams.scope || searchParams.userId) redirect("/shopping");
    return (
      <div>
        <h2 className="mb-3">Shopping List</h2>
        <p className="text-muted">{resolved.error}</p>
      </div>
    );
  }

  const { householdId, scope, userId } = resolved.context;
  const days = buildShoppingListWeek(householdId, week, scope, userId);

  return (
    <div>
      <h2 className="mb-1">Shopping List</h2>
      <p className="text-muted mb-4">
        What this week&rsquo;s meals need. Tick things off as you find them —
        that is remembered per recipe, so two dishes sharing an ingredient keep
        their own lines.
      </p>
      <ShoppingListPanel
        week={week}
        scope={scope}
        requestedUserId={searchParams.userId || session.user.id}
        initialDays={days}
        bare
      />
    </div>
  );
}
