"use client";

import { useId } from "react";

/**
 * The "Crunch Time" micro-animation: bites being taken out of a single pickle.
 *
 * Deliberately NOT the jar shake (`JarShake`) — today's pick and the week's
 * pick are different actions and read as different animations. Implemented as
 * an SVG `<mask>`: the pickle is drawn once, and three circles inside the mask
 * pop from scale(0) to scale(1) in sequence, each punching a round bite-shaped
 * notch out of it, while the pickle itself recoils slightly on each crunch.
 * No hand-authored path data.
 *
 * The timing and reduced-motion rules it shares with the jar live in
 * src/lib/shakeMotion.ts; the CSS lives with `.crunch-*` in globals.css.
 */
export default function PickleCrunch({ label }: { label: string }) {
  // Masks need a document-unique id: both shake buttons can be on the page at
  // once, and ids leak across the whole document.
  const maskId = `pickle-bite-${useId().replace(/:/g, "")}`;

  return (
    <span className="pickle-crunch" role="status" aria-live="polite">
      <svg
        className="crunch-svg"
        viewBox="0 0 48 56"
        width="24"
        height="28"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <mask id={maskId}>
            {/* White keeps, black removes. */}
            <rect x="0" y="0" width="48" height="56" fill="white" />
            <circle className="crunch-bite crunch-bite-1" cx="33" cy="20" r="7" fill="black" />
            <circle className="crunch-bite crunch-bite-2" cx="30" cy="31" r="6" fill="black" />
            <circle className="crunch-bite crunch-bite-3" cx="24" cy="40" r="5.5" fill="black" />
          </mask>
        </defs>
        <g className="crunch-pickle" mask={`url(#${maskId})`}>
          {/* The pickle: one rotated capsule plus two highlight dashes. */}
          <rect
            className="crunch-body"
            x="15"
            y="6"
            width="18"
            height="44"
            rx="9"
            transform="rotate(14 24 28)"
          />
          <rect className="crunch-shine" x="20" y="14" width="3" height="9" rx="1.5" transform="rotate(14 24 28)" />
          <rect className="crunch-shine" x="26" y="26" width="3" height="8" rx="1.5" transform="rotate(14 24 28)" />
        </g>
      </svg>
      <span className="ms-2">{label}</span>
    </span>
  );
}
