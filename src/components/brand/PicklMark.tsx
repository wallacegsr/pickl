/**
 * The Pickl mark: a rounded box with the pickle punched out of it.
 *
 * ---------------------------------------------------------------------------
 * How the negative space works
 * ---------------------------------------------------------------------------
 * The box and the pickle are two subpaths of ONE path with
 * `fill-rule="evenodd"`, so the pickle is a genuine hole and whatever sits
 * behind the mark shows through it. Deliberately not an SVG `<mask>`:
 *
 *   - a mask needs an `id`, and an id in an inlined SVG collides with itself
 *     the moment the mark appears twice on a page (header plus a login card);
 *   - a mask forces an offscreen compositing pass, where a fill rule is just
 *     how the fill is computed;
 *   - Android's VectorDrawable has no masks but does have
 *     `android:fillType="evenOdd"`, so this same geometry drives the launcher
 *     icon rather than being redrawn for it.
 *
 * The one rule to remember when editing PICKLE: it must stay a single
 * non-self-overlapping contour. Two overlapping subpaths cancel under evenodd
 * — which is why the stem is spliced into the body outline rather than added
 * beside it. It was added beside it first, and left a white notch where the
 * two met.
 *
 * ---------------------------------------------------------------------------
 * Colour
 * ---------------------------------------------------------------------------
 * `currentColor`, so CSS owns it entirely and there is one asset rather than
 * one per theme. In the header it inherits `--pickl-topbar-ink` and the hole
 * shows the bar; since the bar is dark under both light and dark mode, the
 * mark needs no theme switching there at all.
 *
 * Negative space only works where the backdrop is known. For a favicon or a
 * launcher icon — which land on a backdrop the app does not control — use
 * `PicklIcon` below, which paints the pickle instead of punching it.
 */

/** The rounded container. Full-bleed on a 108-unit square. */
export const BOX_PATH =
  "M22,0 H86 A22,22 0 0 1 108,22 V86 A22,22 0 0 1 86,108 H22 A22,22 0 0 1 0,86 V22 A22,22 0 0 1 22,0 Z";

/**
 * The gherkin: a diagonal body with a gently scalloped edge and a stem nub,
 * as one contour. Generated from a centreline rather than placed by hand, so
 * the scallops are even; the numbers are baked here because the mark is now
 * fixed artwork, not something to recompute at runtime.
 *
 * Sits inside x 26–78, y 27–82 — within the middle 72 units of the canvas,
 * which is the Android adaptive-icon safe zone, so the same path can be
 * dropped into the launcher foreground without being re-fitted.
 */
export const PICKLE_PATH =
  "M 26.8,74.8 C 25.6,72.7 26.2,70.5 26.4,68.9 C 26.6,67.3 27.5,66.3 28.2,65.2 C 28.9,64.0 29.7,63.1 30.7,62.2 C 31.6,61.2 32.6,60.4 33.6,59.6 C 34.6,58.8 35.7,58.0 36.7,57.2 C 37.7,56.3 38.6,55.5 39.5,54.5 C 40.4,53.6 41.2,52.5 42.0,51.5 C 42.8,50.4 43.5,49.3 44.2,48.2 C 45.0,47.1 45.7,46.0 46.5,45.0 C 47.3,44.0 48.2,43.0 49.1,42.1 C 50.0,41.2 51.1,40.4 52.2,39.7 C 53.3,38.9 54.4,38.3 55.6,37.6 C 56.8,36.9 58.0,36.3 59.2,35.7 C 60.3,35.0 61.5,34.3 62.6,33.6 C 63.7,32.9 64.5,31.9 65.9,31.4 C 67.3,30.9 70.0,30.8 70.8,30.8 C 71.6,30.8 70.4,31.7 70.6,31.4 C 70.8,31.1 71.4,29.8 71.8,29.0 C 72.2,28.3 72.2,27.3 72.8,27.0 C 73.5,26.6 75.0,26.7 75.6,27.1 C 76.3,27.4 76.2,28.4 76.5,29.2 C 76.9,30.0 77.5,30.3 77.6,31.7 C 77.7,33.0 77.2,35.3 77.2,37.2 C 77.3,39.2 78.0,41.6 77.9,43.4 C 77.7,45.1 77.1,46.2 76.5,47.5 C 76.0,48.8 75.3,50.0 74.6,51.1 C 74.0,52.3 73.2,53.3 72.4,54.4 C 71.6,55.4 70.8,56.4 70.0,57.5 C 69.1,58.5 68.3,59.5 67.5,60.5 C 66.7,61.5 65.9,62.5 65.1,63.6 C 64.2,64.6 63.4,65.6 62.6,66.6 C 61.8,67.6 60.9,68.6 60.0,69.5 C 59.1,70.4 58.1,71.3 57.1,72.1 C 56.1,72.9 55.0,73.7 53.9,74.4 C 52.8,75.1 51.6,75.8 50.4,76.4 C 49.2,77.0 47.9,77.6 46.7,78.2 C 45.4,78.8 44.2,79.4 42.9,79.9 C 41.6,80.4 40.5,81.2 38.9,81.4 C 37.3,81.6 35.2,82.3 33.2,81.2 C 31.2,80.1 27.9,76.8 26.8,74.8 Z";

export interface PicklMarkProps {
  /** Rendered size in px; the mark is square. */
  size?: number;
  className?: string;
}

/**
 * The mark as negative space, taking its colour from `currentColor`.
 *
 * `aria-hidden` because every place it is used sits next to the word "Pickl".
 * A logo announced separately from the name it accompanies is read out twice.
 */
export default function PicklMark({ size = 24, className }: PicklMarkProps) {
  return (
    <svg
      viewBox="0 0 108 108"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" fillRule="evenodd" d={`${BOX_PATH} ${PICKLE_PATH}`} />
    </svg>
  );
}

/**
 * The opaque rendering, for anywhere the backdrop is not ours: a favicon, a
 * home-screen icon, an OG image. Same geometry, but the pickle is painted
 * rather than punched, so it cannot land on a background that swallows it.
 */
export function PicklIcon({
  size = 64,
  boxColor = "#3a7d44",
  pickleColor = "#f6f8ef",
  className,
}: {
  size?: number;
  boxColor?: string;
  pickleColor?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 108 108"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path fill={boxColor} d={BOX_PATH} />
      <path fill={pickleColor} d={PICKLE_PATH} />
    </svg>
  );
}
