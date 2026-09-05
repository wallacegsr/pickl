"use client";

import { useEffect, useState } from "react";
import { PALETTE_CHANGE_EVENT } from "@/lib/palette";
import { THEME_CHANGE_EVENT } from "@/lib/theme";

/**
 * Colours for the report charts.
 *
 * Canvas is the reason this file exists. The rest of the app themes itself with
 * CSS custom properties, but Chart.js paints into a <canvas>, where CSS cannot
 * reach — every colour has to be handed over as a literal at render time and
 * re-handed whenever the theme or palette changes.
 *
 * ---------------------------------------------------------------------------
 * Why the series colours are not the app's greens
 * ---------------------------------------------------------------------------
 * The app's palette is deliberately green on green. That is fine for chrome,
 * where nothing depends on telling two greens apart, and wrong for a chart,
 * where the colour *is* the data. Three greens are indistinguishable to a
 * red-green colourblind reader, and an amber/green/clay set is no better: green
 * against clay measures ΔE 1.1 under deuteranopia — effectively the same colour.
 *
 * These sets were checked with the palette validator rather than chosen by eye,
 * against all four surfaces this app can present (both palettes x light/dark):
 *
 *   light  #a8700f #009698 #b8503f   worst adjacent pair ΔE 12.3 deutan,
 *                                    19.9 normal, all >= 3:1 on surface
 *   dark   #bd8420 #009a9d #c95a48   worst adjacent pair ΔE 12.5 deutan,
 *                                    20.7 normal, all >= 3:1 on surface
 *
 * The dark set is a separate selection, not a lightened copy: the validator's
 * dark lightness band (L 0.48-0.67) is narrower and darker than the light one,
 * and the obvious pastel flip of the light set failed it outright.
 *
 * Teal rather than blue keeps faith with the app's no-blue rule while still
 * separating on the blue-yellow axis, which is the axis red-green colour
 * blindness leaves intact. It was the least blue option that cleared the
 * chroma floor.
 */

export interface ChartTheme {
  /** Categorical series colours, in fixed order. Never cycled. */
  categorical: [string, string, string];
  /** Single-series fill, for the one-measure bar chart. */
  single: string;
  /** Axis and tick labels. */
  ink: string;
  muted: string;
  /** Grid lines — recessive by design. */
  grid: string;
  /** The surface charts sit on; used for the gap between adjacent fills. */
  surface: string;
  dark: boolean;
}

const LIGHT: ChartTheme = {
  categorical: ["#a8700f", "#009698", "#b8503f"],
  single: "#3a7d44",
  ink: "#20261e",
  muted: "#55604f",
  grid: "rgba(32, 38, 30, 0.12)",
  surface: "#ffffff",
  dark: false,
};

const DARK: ChartTheme = {
  categorical: ["#bd8420", "#009a9d", "#c95a48"],
  single: "#4e9c5a",
  ink: "#e6ebe0",
  muted: "rgba(230, 235, 224, 0.72)",
  grid: "rgba(230, 235, 224, 0.14)",
  surface: "#141a14",
  dark: true,
};

function currentTheme(): ChartTheme {
  if (typeof document === "undefined") return LIGHT;
  const dark =
    document.documentElement.getAttribute("data-bs-theme") === "dark";
  const base = dark ? DARK : LIGHT;
  // The surface is read live rather than hardcoded, because the two palettes
  // use different page backgrounds and the fills are separated by a gap in
  // that colour.
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  return { ...base, surface: bodyBg || base.surface };
}

/**
 * Tracks the theme and palette, so a chart repaints when either changes.
 *
 * Starts on the light set so the first client render matches the server's
 * markup, then corrects on mount — the same reason the theme radios and the
 * sidebar chevron do it that way. Charts are client-only anyway (see
 * ReportCharts), so nothing is painted with the wrong values.
 */
export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState<ChartTheme>(LIGHT);

  useEffect(() => {
    const read = () => setTheme(currentTheme());
    read();

    window.addEventListener(THEME_CHANGE_EVENT, read);
    window.addEventListener(PALETTE_CHANGE_EVENT, read);

    // "Match my system" resolves through a media query rather than either
    // event above, so a system flip while the page is open would otherwise
    // leave the charts on the old colours.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", read);

    // Belt and braces: ThemeSync writes the attribute directly on load, which
    // can land after this effect has already read it.
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-bs-theme", "data-pickl-palette"],
    });

    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, read);
      window.removeEventListener(PALETTE_CHANGE_EVENT, read);
      media.removeEventListener("change", read);
      observer.disconnect();
    };
  }, []);

  return theme;
}

/** Honours the OS reduced-motion setting for chart entry animations. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const read = () => setReduced(media.matches);
    read();
    media.addEventListener("change", read);
    return () => media.removeEventListener("change", read);
  }, []);
  return reduced;
}
