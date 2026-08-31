"use client";

/**
 * Colour palette ("tone"), independent of light/dark mode.
 *
 * Two axes, deliberately separate: `data-bs-theme` decides light vs dark, and
 * `data-pickl-palette` decides which set of hues fills it. Every combination is
 * defined in src/styles/pickl-bootstrap.scss, so bright works in dark mode and
 * the default works in light.
 *
 * ---------------------------------------------------------------------------
 * Why localStorage rather than the database
 * ---------------------------------------------------------------------------
 * The theme preference is stored per user and syncs across devices; this one
 * follows the sidebar's precedent instead and stays local, which is what keeps
 * the feature to one stylesheet block and this file — no column, no migration,
 * no API route, no server round trip on load.
 *
 * The cost is real and worth stating: the choice does not follow you to another
 * device or survive clearing site data. If it should, this becomes a
 * `palettePreference` column alongside `themePreference` and a route mirroring
 * /api/preferences/theme; nothing here would have to change shape.
 */

export type Palette = "default" | "bright";

export const PALETTE_STORAGE_KEY = "pickl-palette-v1";
/** Must stay in sync with the literal in the inline script in src/app/layout.tsx. */
export const PALETTE_HTML_ATTRIBUTE = "data-pickl-palette";
export const PALETTE_CHANGE_EVENT = "pickl-palette-change";

export const PALETTES: { value: Palette; label: string; description: string }[] = [
  {
    value: "default",
    label: "Jar & Brine",
    description: "Deep green and mustard. The original Pickl look.",
  },
  {
    value: "bright",
    label: "Fresh & Sunny",
    description: "Warm cream paper, vivid leaf green and sunny yellow.",
  },
];

export function isPalette(value: unknown): value is Palette {
  return value === "default" || value === "bright";
}

export function readStoredPalette(): Palette {
  try {
    const stored = window.localStorage.getItem(PALETTE_STORAGE_KEY);
    return isPalette(stored) ? stored : "default";
  } catch {
    // Private browsing or storage disabled.
    return "default";
  }
}

/** Reads what the pre-hydration script decided, off the DOM. */
export function readAppliedPalette(): Palette {
  if (typeof document === "undefined") return "default";
  const applied = document.documentElement.getAttribute(PALETTE_HTML_ATTRIBUTE);
  return isPalette(applied) ? applied : "default";
}

export function setPalette(palette: Palette) {
  document.documentElement.setAttribute(PALETTE_HTML_ATTRIBUTE, palette);
  try {
    window.localStorage.setItem(PALETTE_STORAGE_KEY, palette);
  } catch {
    // Still applied for this page view; it just won't survive a reload.
  }
  // Lets any other mounted control follow along, the same way the theme does.
  window.dispatchEvent(
    new CustomEvent<Palette>(PALETTE_CHANGE_EVENT, { detail: palette })
  );
}
