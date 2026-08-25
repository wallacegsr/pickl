"use client";

import { createContext, useContext } from "react";
import type { MealType, Scope } from "@/db/schema";
import type { PlanDayData, RecipeOption } from "@/components/PlanView";
import type { ShoppingListDayData } from "@/components/ShoppingListPanel";

/**
 * One of the viewer's own external calendar events, as returned by
 * /api/calendar/overlay. Held in component state for the life of the page
 * and never sent anywhere — see src/lib/calendar/read.ts for why this shape
 * carries a title and times and nothing else.
 */
export interface ExternalEventView {
  id: string;
  summary: string;
  date: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  multiDay: boolean;
}

export interface OverlayResponse {
  status: string;
  events: ExternalEventView[];
  message: string | null;
}

/**
 * Everything the dashboard widgets need, in one place.
 *
 * The widgets are the old single-page /plan view cut into pieces, and the
 * pieces were never independent: shaking the jar updates the grid *and* the
 * shopping list, and the grid and the calendar widget draw the same fetched
 * events. Splitting them into components that each fetched their own copy
 * would have quietly broken two guarantees at once — the shopping list would
 * stop tracking a shake, and the calendar would be fetched twice per view.
 *
 * So the state stays in exactly one owner (PlanView), which is also the only
 * component that talks to /api/plan, and the widgets are presentational
 * consumers of this context. A widget being removed from the board therefore
 * changes nothing about how the data is loaded — which is what makes
 * "removing a widget is a view change, not a delete" true at the code level
 * and not just in the copy.
 */
export interface PlanContextValue {
  // --- Identity of what is on screen ---
  week: string;
  scope: Scope;
  requestedUserId: string;
  today: string;
  isEditable: boolean;

  // --- The plan itself ---
  days: PlanDayData[];
  recipePoolByMeal: Record<MealType, RecipeOption[]>;
  openSlotEditor: (day: PlanDayData, mealType: MealType) => void;

  // --- Shake controls ---
  selectedMeals: MealType[];
  toggleMeal: (mealType: MealType) => void;
  overwriteWeek: boolean;
  setOverwriteWeek: (value: boolean) => void;
  crunchingToday: boolean;
  shakingWeek: boolean;
  onCrunchToday: () => void;
  onShakeWeek: () => void;

  // --- Shopping list ---
  /**
   * Passed straight through from the server component, by reference. The
   * shopping list widget keys its re-sync effect off this array's identity,
   * which is how it stays live after a shake without a page reload: a shake
   * ends in router.refresh(), the server component rebuilds the list, and a
   * new array arrives here. Do not map, copy or memoize it on the way past —
   * a fresh array on every render would re-sync constantly, and a stable one
   * would never re-sync at all.
   */
  shoppingListDays: ShoppingListDayData[];

  // --- Calendar overlay ---
  /** The viewer's opt-in, as read from their own row on the server. */
  overlayEnabled: boolean;
  /** Whether an overlay is shown for *this* view (opt-in + whose plan it is). */
  overlayApplies: boolean;
  /** null until the post-paint fetch resolves. Never blocks the grid. */
  overlay: OverlayResponse | null;
  overlayByDate: Map<string, ExternalEventView[]>;
  expandedOverlayDates: string[];
  expandOverlayDate: (date: string) => void;
  collapseOverlayDate: (date: string) => void;
}

const PlanContext = createContext<PlanContextValue | null>(null);

export const PlanContextProvider = PlanContext.Provider;

export function usePlanContext(): PlanContextValue {
  const value = useContext(PlanContext);
  if (!value) {
    throw new Error("usePlanContext must be used inside PlanView");
  }
  return value;
}
