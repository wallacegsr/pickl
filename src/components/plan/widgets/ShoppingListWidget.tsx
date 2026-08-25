"use client";

import ShoppingListPanel from "@/components/ShoppingListPanel";
import { usePlanContext } from "../PlanContext";

/**
 * The Today / Full Week ingredient checklist, unchanged.
 *
 * `shoppingListDays` is handed straight through from the server component by
 * reference — see the note on PlanContextValue.shoppingListDays. That prop
 * identity is the mechanism that keeps this list in step with a shake
 * without a page reload, so it must not be copied or memoized on the way
 * here.
 */
export default function ShoppingListWidget() {
  const { week, scope, requestedUserId, shoppingListDays } = usePlanContext();
  return (
    <ShoppingListPanel
      bare
      week={week}
      scope={scope}
      requestedUserId={requestedUserId}
      initialDays={shoppingListDays}
    />
  );
}
