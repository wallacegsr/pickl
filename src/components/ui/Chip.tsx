"use client";

import type { ReactNode } from "react";

/**
 * A filter chip: outlined when off, tinted when on. One accent colour, used
 * only to mean "this is on" — the same rule the tick in ListRow follows.
 */
export default function Chip({
  label,
  active,
  onClick,
  title,
}: {
  label: ReactNode;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`pickl-chip${active ? " pickl-chip-on" : ""}`}
      aria-pressed={active}
      title={title}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/** A single scrolling line of chips; it never wraps into a wall. */
export function ChipRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="pickl-chiprow" role="group" aria-label={label}>
      {children}
    </div>
  );
}
