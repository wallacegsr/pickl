/**
 * Icons for the app shell, from Lucide.
 *
 * These were hand-rolled SVGs, on the reasoning that eight glyphs did not
 * justify a dependency. That held until it did not: the set grew past a dozen,
 * and hand-drawing them produced a real bug — the "User Settings" gear was a
 * sun, identical to the light-mode toggle two rows below it in the same menu.
 * A drawn-by-hand icon set has no such thing as a wrong-but-obvious glyph;
 * a named import does.
 *
 * lucide-react is tree-shaken per icon, so the bundle carries only the ~13
 * glyphs named below rather than the whole library.
 *
 * This module stays the single import site rather than letting components
 * reach for Lucide directly. That keeps the app's names for things (the
 * reports tab is "Past Preserves", and its icon is a jar, not an amphora), and
 * keeps size and stroke weight defined once instead of at every call site.
 */

import {
  Amphora,
  BookOpen,
  CalendarDays,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
  Moon,
  RefreshCw,
  Server,
  Settings,
  Shield,
  Sun,
  Tag,
  type LucideIcon,
} from "lucide-react";

export interface IconProps {
  /** Rendered pixel size; icons are square. */
  size?: number;
  className?: string;
}

/**
 * Wraps a Lucide glyph with this app's defaults.
 *
 * Lucide draws at strokeWidth 2 and size 24; 1.75 at 18 is what the previous
 * hand-drawn set used, and what the sidebar's text weight is balanced against.
 * Every icon here sits beside a text label or inside a button carrying its own
 * aria-label, so all of them are decorative and hidden from assistive tech.
 */
function icon(Glyph: LucideIcon, name: string) {
  function Wrapped({ size = 18, className }: IconProps) {
    return (
      <Glyph
        size={size}
        className={className}
        strokeWidth={1.75}
        aria-hidden="true"
        focusable="false"
      />
    );
  }
  Wrapped.displayName = name;
  return Wrapped;
}

// --- Sidebar destinations -------------------------------------------------
/** Plan. */
export const CalendarIcon = icon(CalendarDays, "CalendarIcon");
/** Recipes. */
export const BookIcon = icon(BookOpen, "BookIcon");
/** Tags. */
export const TagIcon = icon(Tag, "TagIcon");
/**
 * Past Preserves. An amphora is the closest thing Lucide has to a preserving
 * jar, and reads as one at 18px.
 */
export const JarIcon = icon(Amphora, "JarIcon");

// --- Account menu ---------------------------------------------------------
/** User Settings. */
export const GearIcon = icon(Settings, "GearIcon");
/** Back of House (admin). */
export const ShieldIcon = icon(Shield, "ShieldIcon");
/** Switch to light. */
export const SunIcon = icon(Sun, "SunIcon");
/** Switch to dark. */
export const MoonIcon = icon(Moon, "MoonIcon");
/** Reload, in the Android shell. */
export const RefreshIcon = icon(RefreshCw, "RefreshIcon");
/** Change server, in the Android shell. */
export const ServerIcon = icon(Server, "ServerIcon");
/** Sign out. */
export const SignOutIcon = icon(LogOut, "SignOutIcon");

// --- Sidebar rail ---------------------------------------------------------
export const ChevronsLeftIcon = icon(ChevronsLeft, "ChevronsLeftIcon");
export const ChevronsRightIcon = icon(ChevronsRight, "ChevronsRightIcon");
