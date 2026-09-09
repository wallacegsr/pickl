/**
 * Contrast check for every alternate palette.
 *
 * Reads the palettes straight out of src/styles/pickl-bootstrap.scss rather
 * than keeping a second copy of the colours here. A validator with its own
 * copy of the values reports on a palette that may no longer be the one being
 * served, which is worse than no validator.
 *
 * It replicates three Bootstrap behaviours so the numbers describe what
 * actually ships: `tint-color`/`shade-color` (a plain RGB mix), `luminance`
 * (WCAG relative luminance), and `color-contrast` — the function that decides
 * whether a button gets a black or a white label, which is why button labels
 * can be checked at all without rendering anything.
 *
 * Usage: node scripts/check-palettes.mjs [--verbose]
 * Exits non-zero if any pair fails its threshold.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCSS = path.join(root, "src", "styles", "pickl-bootstrap.scss");

// --- colour maths ----------------------------------------------------------

function parseHex(hex) {
  const h = hex.trim().replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

const toHex = (rgb) =>
  "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/** Sass `mix($a, $b, $weight)`: $weight of $a. */
const mix = (a, b, weight) => a.map((v, i) => v * weight + b[i] * (1 - weight));

const tint = (c, weight) => mix([255, 255, 255], c, weight);
const shade = (c, weight) => mix([0, 0, 0], c, weight);

/** WCAG relative luminance. */
function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s < 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * Bootstrap's `color-contrast()`, which is what picks a button's label — the
 * first candidate clearing `$min-contrast-ratio`, else whichever is closest.
 *
 * The candidates are read from the stylesheet rather than assumed to be white
 * and black. This project sets `$color-contrast-dark: $gray-900`, so a
 * dark-labelled button carries #20261e ink, and measuring pure black instead
 * overstates every one of them.
 */
function autoLabel(fill, settings) {
  const { contrastLight, contrastDark, minRatio } = settings;
  const candidates = [contrastLight, contrastDark, [255, 255, 255], [0, 0, 0]];
  let best = null;
  for (const fg of candidates) {
    const r = ratio(fill, fg);
    if (r > minRatio) return fg;
    if (!best || r > best.r) best = { fg, r };
  }
  return best.fg;
}

/**
 * The contrast settings this stylesheet actually compiles with, resolved
 * through its own `$name: #hex` assignments so a change to $gray-900 moves
 * these numbers too.
 */
function readSettings(source) {
  const vars = {};
  for (const m of source.matchAll(/^\$([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/gm)) {
    vars[m[1]] = parseHex(m[2]);
  }
  const resolve = (name, fallback) => {
    const re = new RegExp(
      "^\\$" + name + ":\\s*(\\$[a-z0-9-]+|#[0-9a-fA-F]{3,6})\\s*;",
      "m"
    );
    const m = source.match(re);
    if (!m) return fallback;
    return m[1].startsWith("#") ? parseHex(m[1]) : vars[m[1].slice(1)] ?? fallback;
  };
  const ratioMatch = source.match(/^\$min-contrast-ratio:\s*([\d.]+)\s*;/m);
  return {
    contrastLight: resolve("color-contrast-light", [255, 255, 255]),
    contrastDark: resolve("color-contrast-dark", [0, 0, 0]),
    minRatio: ratioMatch ? Number(ratioMatch[1]) : 4.5,
  };
}

// --- read the palettes out of the stylesheet -------------------------------

function readPalettes(source) {
  const palettes = [];
  const re = /@include\s+pickl-palette\(\s*"([^"]+)"\s*,\s*\(([\s\S]*?)\n\s*\)\s*\);/g;
  let m;
  while ((m = re.exec(source))) {
    const [, name, body] = m;
    const colours = {};
    for (const line of body.split("\n")) {
      const pair = line.match(/^\s*([a-z-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\s*,?/);
      if (pair) colours[pair[1]] = parseHex(pair[2]);
    }
    palettes.push({ name, colours });
  }
  return palettes;
}

// --- the checks ------------------------------------------------------------

/**
 * Thresholds, and why each one.
 *
 * 4.5 is the WCAG AA floor for body-sized text; 3.0 is the floor for large
 * text and for non-text UI that has to be distinguishable (a border, a focus
 * ring). Body text is held to 7.0 — AAA — because it is the thing every screen
 * is mostly made of, and it costs nothing to hit with a dark ink on a light
 * ground.
 */
function checksFor({ colours: c }, settings) {
  const rows = [];

  const add = (mode, label, fg, bg, min) =>
    rows.push({ mode, label, fg, bg, min, value: ratio(fg, bg) });

  // --- light mode ---
  add("light", "body text on background", c.fg, c.bg, 7);
  add("light", "muted text on background", c.muted, c.bg, 4.5);
  add("light", "body text on raised surface", c.fg, c.tertiary, 7);
  add("light", "link on background", c.link, c.bg, 4.5);
  add("light", "link hover on background", shade(c.link, 0.2), c.bg, 4.5);
  add("light", "border against background", c.border, c.bg, 1.3);

  // --- dark mode ---
  add("dark", "body text on background", c["fg-dark"], c["bg-dark"], 7);
  add("dark", "muted text on background", mix(c["fg-dark"], c["bg-dark"], 0.78), c["bg-dark"], 4.5);
  add("dark", "body text on raised surface", c["fg-dark"], c["tertiary-dark"], 7);
  add("dark", "link on background", tint(c.primary, 0.55), c["bg-dark"], 4.5);
  add("dark", "border against background", c["border-dark"], c["bg-dark"], 1.3);
  add("dark", "primary emphasis text", tint(c.primary, 0.55), c["bg-dark"], 4.5);
  add("dark", "success emphasis text", tint(c.success, 0.45), c["bg-dark"], 4.5);
  add("dark", "warning emphasis text", tint(c.warning, 0.3), c["bg-dark"], 4.5);
  add("dark", "danger emphasis text", tint(c.danger, 0.45), c["bg-dark"], 4.5);

  // --- buttons: the auto-picked label against its own fill ---
  for (const role of ["primary", "secondary", "success", "info", "warning", "danger"]) {
    const fill = c[role];
    const label = autoLabel(fill, settings);
    const ink = toHex(label) === "#ffffff" ? "light" : "dark";
    rows.push({
      mode: "both",
      label: `btn-${role} label (${ink} ${toHex(label)}) on fill`,
      fg: label,
      bg: fill,
      min: settings.minRatio,
      value: ratio(label, fill),
    });
  }

  // A filled button also has to be visible as a shape against the page.
  add("light", "primary fill against background", c.primary, c.bg, 1.4);
  add("dark", "primary fill against background", c.primary, c["bg-dark"], 1.4);

  return rows;
}

// --- report ----------------------------------------------------------------

const verbose = process.argv.includes("--verbose");
const source = fs.readFileSync(SCSS, "utf8");
const palettes = readPalettes(source);
const settings = readSettings(source);

if (palettes.length === 0) {
  console.error("No `@include pickl-palette(...)` blocks found in " + SCSS);
  process.exit(1);
}

console.log(
  `Label candidates: light ${toHex(settings.contrastLight)}, dark ${toHex(settings.contrastDark)}, ` +
    `threshold ${settings.minRatio}:1 — read from the stylesheet.`
);

let failures = 0;

for (const palette of palettes) {
  const rows = checksFor(palette, settings);
  const bad = rows.filter((r) => r.value < r.min);
  failures += bad.length;

  const worst = rows.reduce((a, b) => (a.value < b.value ? a : b));
  console.log(
    `\n${palette.name}  —  ${rows.length} pairs, ${bad.length} failing, ` +
      `worst ${worst.value.toFixed(2)}:1 (${worst.label})`
  );

  for (const r of rows) {
    const ok = r.value >= r.min;
    if (!ok || verbose) {
      console.log(
        `  ${ok ? "ok  " : "FAIL"}  ${r.mode.padEnd(5)} ${r.label.padEnd(38)} ` +
          `${r.value.toFixed(2).padStart(6)}:1  (min ${r.min})`
      );
    }
  }
}

console.log(
  failures === 0
    ? `\nAll ${palettes.length} palettes pass.`
    : `\n${failures} failing pair(s).`
);
process.exit(failures === 0 ? 0 : 1);
