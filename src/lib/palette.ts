"use client";

/**
 * Colour palette ("tone"), independent of light/dark mode.
 *
 * Two axes, deliberately separate: `data-bs-theme` decides light vs dark, and
 * `data-pickl-palette` decides which set of hues fills it. Every palette is
 * defined for both modes in src/styles/pickl-bootstrap.scss, so all of them
 * work either way round — the combinations are a grid, not a list.
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

// The names and keys live in a module without "use client" so the root layout
// can read them on the server to build its pre-hydration script. Re-exported
// here so existing importers do not have to care which file they came from.
export {
  PALETTE_VALUES,
  DEFAULT_PALETTE,
  PALETTE_STORAGE_KEY,
  PALETTE_HTML_ATTRIBUTE,
  PALETTE_CHANGE_EVENT,
  isPalette,
  type Palette,
} from "@/lib/paletteValues";

import {
  DEFAULT_PALETTE,
  isPalette,
  PALETTE_CHANGE_EVENT,
  PALETTE_HTML_ATTRIBUTE,
  PALETTE_STORAGE_KEY,
  type Palette,
} from "@/lib/paletteValues";

export const PALETTES: { value: Palette; label: string; description: string }[] = [
  {
    value: "default",
    label: "Jar & Brine",
    description: "Deep green and mustard. The original Pickl look.",
  },
  {
    // Still keyed "bright": the scheme was renamed, not replaced, and changing
    // the stored value would silently reset the choice for anyone using it.
    value: "bright",
    label: "Fresh & Crisp",
    description: "Pale mint on near-black green. Designed dark, and dressed for light.",
  },
  {
    value: "golden",
    label: "Golden Hour",
    description: "Amber and bronze on warm paper.",
  },
  {
    value: "brick",
    label: "Brick",
    description: "Terracotta and warm clay.",
  },
  {
    value: "slate",
    label: "Slate",
    description: "Cool indigo on near-white. Crisp and plain.",
  },
  {
    value: "graphite",
    label: "Graphite",
    description: "Near-neutral greys, with colour kept for what means something.",
  },
];

export function readStoredPalette(): Palette {
  try {
    const stored = window.localStorage.getItem(PALETTE_STORAGE_KEY);
    return isPalette(stored) ? stored : DEFAULT_PALETTE;
  } catch {
    // Private browsing or storage disabled.
    return DEFAULT_PALETTE;
  }
}

/** Reads what the pre-hydration script decided, off the DOM. */
export function readAppliedPalette(): Palette {
  if (typeof document === "undefined") return DEFAULT_PALETTE;
  const applied = document.documentElement.getAttribute(PALETTE_HTML_ATTRIBUTE);
  return isPalette(applied) ? applied : DEFAULT_PALETTE;
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
