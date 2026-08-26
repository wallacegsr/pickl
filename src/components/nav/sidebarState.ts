"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Collapsed/expanded state for the left sidebar.
 *
 * Lives in localStorage, not the database, for the same reason the meal plan's
 * column widths do (see src/components/plan/useResizableColumns.ts): whether
 * you want a rail or a full sidebar is a function of how wide *this* window
 * is. A choice made on a laptop should not follow you to a 27" monitor.
 *
 * ---------------------------------------------------------------------------
 * Avoiding a flash of the wrong width
 * ---------------------------------------------------------------------------
 * The width is NOT a React prop on the sidebar element. It comes from CSS,
 * keyed off a `data-pickl-sidebar` attribute on <html> that the inline script
 * in src/app/layout.tsx stamps before hydration — exactly the trick the theme
 * already uses, and for the same reason: localStorage is the only thing
 * readable that early without blocking on the network.
 *
 * That also sidesteps a hydration mismatch. The server cannot know the stored
 * value, so if React rendered the width the first client render would disagree
 * with the server's HTML. Instead both render identical markup — labels and
 * all — and CSS hides the labels and narrows the rail. The React state below
 * exists only for the things CSS cannot express: `aria-expanded` and the
 * direction of the toggle chevron. It starts at the expanded default and is
 * corrected in an effect on the first commit, so the accessible state settles
 * a frame after paint while the *visual* width is never wrong.
 */

export const SIDEBAR_STORAGE_KEY = "pickl-sidebar-collapsed-v1";
/** Must stay in sync with the literal in the inline script in src/app/layout.tsx. */
export const SIDEBAR_HTML_ATTRIBUTE = "data-pickl-sidebar";

export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // The pre-hydration script has already decided; read its answer off the
    // DOM rather than re-reading localStorage, so the two can never diverge.
    setCollapsed(
      document.documentElement.getAttribute(SIDEBAR_HTML_ATTRIBUTE) === "collapsed"
    );
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      document.documentElement.setAttribute(
        SIDEBAR_HTML_ATTRIBUTE,
        next ? "collapsed" : "expanded"
      );
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Private browsing / storage disabled. The toggle still works for this
        // page view, it just won't survive a reload.
      }
      return next;
    });
  }, []);

  return { collapsed, toggle };
}
