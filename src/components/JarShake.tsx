"use client";

import { useId } from "react";

/**
 * The "Shake the Jar" micro-animation: a small pickle jar with recipe cards
 * tumbling inside it, shown while a shake request is in flight.
 *
 * Pure CSS + inline SVG (see the `.jar-shake*` rules in globals.css) — no
 * dependencies, no images. Colours come from Bootstrap's theme variables so it
 * works under both `data-bs-theme` values, and `prefers-reduced-motion` is
 * handled in two layers: the CSS stops all movement, and the caller
 * (`minAnimationElapsed`) skips the artificial minimum duration entirely so a
 * reduced-motion user goes straight to the result.
 */
export default function JarShake({ label }: { label: string }) {
  // The clipPath needs a document-unique id: two jars can be on the page at
  // once (one per shake button) even though only one animates at a time.
  const clipId = `jar-inside-${useId().replace(/:/g, "")}`;

  return (
    <span className="jar-shake" role="status" aria-live="polite">
      <svg
        className="jar-shake-svg"
        viewBox="0 0 48 56"
        width="24"
        height="28"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <clipPath id={clipId}>
            <rect x="9" y="16" width="30" height="34" rx="6" />
          </clipPath>
        </defs>
        {/* Lid + neck */}
        <rect className="jar-lid" x="13" y="3" width="22" height="7" rx="2" />
        <rect className="jar-neck" x="16" y="10" width="16" height="5" rx="1" />
        {/* Body */}
        <rect className="jar-body" x="8" y="15" width="32" height="36" rx="7" />
        {/* Recipe cards tumbling inside, clipped to the jar's interior */}
        <g clipPath={`url(#${clipId})`}>
          <rect className="jar-card jar-card-1" x="13" y="26" width="14" height="9" rx="2" />
          <rect className="jar-card jar-card-2" x="22" y="33" width="13" height="9" rx="2" />
          <rect className="jar-card jar-card-3" x="15" y="39" width="12" height="8" rx="2" />
        </g>
      </svg>
      <span className="ms-2">{label}</span>
    </span>
  );
}
