"use client";

import { useEffect } from "react";
import {
  applyResolvedTheme,
  isThemePreference,
  readStoredPreference,
  readStoredPreferenceOwner,
  resolveTheme,
  writeStoredPreference,
  THEME_CHANGE_EVENT,
  type ThemePreference,
} from "@/lib/theme";

/**
 * Reconciles the browser-local theme with the logged-in user's saved
 * preference, and keeps "system" tracking the OS setting.
 *
 * Renders nothing. Mounted once in the authenticated layout, where the server
 * already knows who is logged in and what they saved.
 *
 * Why this doesn't flash or cause a hydration mismatch:
 *  - The inline script in src/app/layout.tsx has already stamped
 *    `data-bs-theme` from localStorage before first paint, so the page is
 *    painted correctly before this component exists.
 *  - This runs in an effect (after paint) and touches only a DOM *attribute*
 *    on <html>, which React does not own — no server/client markup differs, so
 *    there is nothing for hydration to disagree about.
 *  - In the overwhelmingly common case the saved preference and the local one
 *    already match and the reconciliation is a no-op. They can only differ on
 *    a browser that has never seen this account (no local value to flash from)
 *    or one where the same account genuinely chose differently on another
 *    device — the case the DB copy exists to fix.
 */
export default function ThemeSync({
  userId,
  savedPreference,
}: {
  userId: string;
  savedPreference: string;
}) {
  useEffect(() => {
    const saved: ThemePreference = isThemePreference(savedPreference)
      ? savedPreference
      : "system";

    const localOwner = readStoredPreferenceOwner();
    const local = readStoredPreference();

    // The saved preference wins on load: it is the account's choice, whereas
    // the local value may belong to a different account that used this
    // browser, or be older than a change made on another device.
    //
    // Assert it onto the DOM unconditionally rather than only when it differs
    // from the local copy. The attribute is set before hydration by an inline
    // script, and anything that re-creates <html> afterwards — a hydration
    // recovery, a stray extension — drops it. When that happened the old
    // guard did nothing, because localStorage and the database agreed
    // perfectly: the page just sat there in the wrong theme while storage
    // insisted it was dark. Re-applying is idempotent and costs one attribute
    // write per load.
    applyResolvedTheme(resolveTheme(saved));

    // Storage and listeners only need touching when something actually moved.
    if (localOwner !== userId || local !== saved) {
      writeStoredPreference(saved, userId);
      window.dispatchEvent(
        new CustomEvent<ThemePreference>(THEME_CHANGE_EVENT, { detail: saved })
      );
    }
  }, [userId, savedPreference]);

  // Follow the OS while the preference is "system".
  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readStoredPreference() === "system") {
        applyResolvedTheme(resolveTheme("system"));
      }
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return null;
}
