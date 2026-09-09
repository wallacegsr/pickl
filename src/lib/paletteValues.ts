/**
 * The palette names and storage keys, in a module with no "use client".
 *
 * These live apart from src/lib/palette.ts so the root layout can read them on
 * the server. A "use client" module's exports become client references when a
 * server component imports them, which is fine for components and useless for
 * plain data — and the root layout needs the actual array to build its
 * pre-hydration script.
 *
 * That script used to carry its own hardcoded `"bright"` with a comment asking
 * the next person to keep it in step. This is that comment, made unnecessary:
 * add a palette to the array below and the inline script accepts it.
 */

export const PALETTE_VALUES = [
  "default",
  "bright",
  "golden",
  "brick",
  "slate",
  "graphite",
] as const;

export type Palette = (typeof PALETTE_VALUES)[number];

export const DEFAULT_PALETTE: Palette = "default";

export const PALETTE_STORAGE_KEY = "pickl-palette-v1";
export const PALETTE_HTML_ATTRIBUTE = "data-pickl-palette";
export const PALETTE_CHANGE_EVENT = "pickl-palette-change";

export function isPalette(value: unknown): value is Palette {
  return (PALETTE_VALUES as readonly unknown[]).includes(value);
}
