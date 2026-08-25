import { eq } from "drizzle-orm";
import { db } from "@/db";
import { dashboardLayouts } from "@/db/schema";
import {
  DASHBOARD_LAYOUT_VERSION,
  defaultDashboardLayout,
  parseStoredLayout,
  type DashboardLayout,
} from "./widgets";

/**
 * Reads/writes one user's dashboard arrangement.
 *
 * Every function here takes `userId` as its first argument and every caller
 * passes `session.user.id`. There is intentionally no variant that accepts a
 * user id from a request body or query string: a dashboard layout is
 * self-service only, there is no admin view of someone else's board, and so
 * no code path exists that could be handed the wrong id.
 *
 * Reads always go through reconcileLayout (via parseStoredLayout), so a row
 * written by an older release — naming a widget that has since been deleted,
 * or missing one that has since been added — still produces a renderable
 * layout. Nothing is repaired in the database on read; the stored text is
 * only rewritten when the user themselves changes something.
 */

export function getDashboardLayout(userId: string): DashboardLayout {
  if (!userId) return defaultDashboardLayout();
  const row = db
    .select({ layoutJson: dashboardLayouts.layoutJson })
    .from(dashboardLayouts)
    .where(eq(dashboardLayouts.userId, userId))
    .get();
  // No row at all is the brand-new-user case: they land on the shipped
  // default arrangement, not an empty canvas.
  return parseStoredLayout(row?.layoutJson);
}

export function saveDashboardLayout(
  userId: string,
  layout: DashboardLayout
): DashboardLayout {
  const stored: DashboardLayout = {
    v: DASHBOARD_LAYOUT_VERSION,
    items: layout.items,
    hidden: layout.hidden,
  };
  db.insert(dashboardLayouts)
    .values({
      userId,
      layoutJson: JSON.stringify(stored),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: dashboardLayouts.userId,
      set: { layoutJson: JSON.stringify(stored), updatedAt: new Date() },
    })
    .run();
  return stored;
}

/**
 * "Reset to default" — deletes the row rather than writing the current
 * default into it, so a later change to the shipped default reaches everyone
 * who never customised their board.
 */
export function resetDashboardLayout(userId: string): DashboardLayout {
  db.delete(dashboardLayouts).where(eq(dashboardLayouts.userId, userId)).run();
  return defaultDashboardLayout();
}
