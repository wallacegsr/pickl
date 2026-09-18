"use client";

import type { ReactNode } from "react";

/**
 * One row of a list: a name, a quiet line of detail under it, and a trailing
 * mark. The whole row is the target.
 *
 * The detail line is deliberately plain grey text rather than a row of
 * coloured badges. Three filled pills beside a recipe name read louder than
 * the name, which is the wrong way round when the name is what you are looking
 * for; colour is kept for the one thing that is a state — being chosen.
 */
export default function ListRow({
  title,
  meta,
  selected = false,
  disabled = false,
  trailing,
  onClick,
  as,
  href,
}: {
  title: ReactNode;
  meta?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  /** Replaces the tick — a chevron, a count, nothing. */
  trailing?: ReactNode;
  onClick?: () => void;
  /** Defaults to a button when it does something, plain text when it doesn't. */
  as?: "button" | "a" | "div";
  href?: string;
}) {
  const className = `pickl-row${selected ? " pickl-row-selected" : ""}`;
  const inner = (
    <>
      <span className="pickl-row-text">
        <span className="pickl-row-title">{title}</span>
        {meta && <span className="pickl-row-meta">{meta}</span>}
      </span>
      <span className="pickl-row-trailing" aria-hidden={trailing === undefined}>
        {trailing !== undefined ? trailing : selected ? "✓" : ""}
      </span>
    </>
  );

  const kind = as ?? (href ? "a" : onClick ? "button" : "div");

  if (kind === "a") {
    return (
      <a className={className} href={href}>
        {inner}
      </a>
    );
  }
  if (kind === "div") {
    return <div className={className}>{inner}</div>;
  }
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={onClick ? selected : undefined}
    >
      {inner}
    </button>
  );
}

/** A group of rows: hairline dividers between them, none at the edges. */
export function ListRows({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="pickl-rows" role="group" aria-label={label}>
      {children}
    </div>
  );
}

/** A quiet section heading inside a list. */
export function ListSection({ children }: { children: ReactNode }) {
  return <div className="pickl-rows-section">{children}</div>;
}
