/**
 * Client-side theme helpers. Deliberately free of any DB/server import so it
 * can be pulled into client components without dragging better-sqlite3 in.
 *
 * How the two stores relate:
 *
 *  - localStorage (`dinner-planner-theme`) is the *pre-hydration* source. The
 *    inline script in src/app/layout.tsx reads it and stamps `data-bs-theme`
 *    on <html> before React ever runs, which is what avoids a flash of the
 *    wrong theme. It has to be localStorage: nothing else is readable that
 *    early without blocking on the network.
 *  - The `users.theme_preference` column is the *durable* copy, so the choice
 *    follows the user to a new device or browser.
 *
 * They can disagree in exactly one interesting case — a browser whose
 * localStorage was last written by a *different* account. `dinner-planner-
 * theme-user` records which user id the local value belongs to; ThemeSync
 * uses it to decide whether the DB value should override.
 *
 * The three keys below keep their pre-"Pickl" names on purpose: they are never
 * shown to a user, and renaming them would silently discard the saved theme of
 * everyone who already has one. THEME_STORAGE_KEY must also stay in step with
 * the hard-coded literal in the inline script in src/app/layout.tsx.
 */

export const THEME_STORAGE_KEY = "dinner-planner-theme";
export const THEME_USER_STORAGE_KEY = "dinner-planner-theme-user";
/** Fired on `window` whenever the preference changes, so the navbar toggle
 *  and the Appearance panel stay in step while both are on screen. */
export const THEME_CHANGE_EVENT = "dinner-planner-theme-change";

export type ThemePreference = "light" | "dark" | "system";
/** What actually gets written to `data-bs-theme` — "system" is resolved away. */
export type ResolvedTheme = "light" | "dark";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/** Resolves "system" against the OS setting; passes light/dark straight through. */
export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference;
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyResolvedTheme(theme: ResolvedTheme) {
  document.documentElement.setAttribute("data-bs-theme", theme);
}

export function readStoredPreference(): ThemePreference | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function writeStoredPreference(
  preference: ThemePreference,
  userId?: string | null
) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
    if (userId) localStorage.setItem(THEME_USER_STORAGE_KEY, userId);
  } catch {
    // localStorage unavailable (private browsing, etc) — the theme still
    // applies for this page view, it just won't survive a reload.
  }
}

export function readStoredPreferenceOwner(): string | null {
  try {
    return localStorage.getItem(THEME_USER_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Applies a preference everywhere it needs to go: the DOM (immediately),
 * localStorage (for the next no-flash paint), the DB (when logged in), and a
 * window event so any other mounted theme control updates.
 *
 * The DB write is deliberately fire-and-forget — a failed persist must never
 * block or revert the visual change the user just asked for.
 */
export function setThemePreference(
  preference: ThemePreference,
  options: { userId?: string | null; persist?: boolean } = {}
) {
  const { userId = null, persist = true } = options;

  applyResolvedTheme(resolveTheme(preference));
  writeStoredPreference(preference, userId);
  window.dispatchEvent(
    new CustomEvent<ThemePreference>(THEME_CHANGE_EVENT, { detail: preference })
  );

  if (persist && userId) {
    void fetch("/api/preferences/theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: preference }),
    }).catch(() => {
      // Offline / transient failure. The local choice still stands.
    });
  }
}
