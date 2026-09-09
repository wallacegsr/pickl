"use client";

import type { ReactNode } from "react";
import { Table } from "react-bootstrap";

/**
 * A data table that becomes a stack of cards on a phone.
 *
 * A seven-column table of counts is fine at a desk and unreadable on a 375px
 * screen, where `table-responsive` leaves you dragging a wide grid sideways
 * with no header in view. Below the phone breakpoint the CSS in globals.css
 * turns each row into a card and prints each cell's column name beside its
 * value, so the header travels with the data instead of scrolling away.
 *
 * The roles are the price of that. Changing a table's `display` drops the
 * implicit table/row/cell semantics browsers give it, so a screen reader
 * would announce a pile of generic groups; the explicit roles below put them
 * back, and are inert at desk width where the display is already a table.
 *
 * Cells carry their column name in `label`. It is required rather than
 * optional because a card whose values have no labels is worse than the
 * sideways-scrolling table it replaced.
 */
export function StackedTable({
  children,
  className,
  ...rest
}: {
  children: ReactNode;
  className?: string;
} & React.ComponentProps<typeof Table>) {
  return (
    <div className="table-responsive">
      <Table
        role="table"
        bordered
        size="sm"
        className={["pickl-stacked-table", className].filter(Boolean).join(" ")}
        {...rest}
      >
        {children}
      </Table>
    </div>
  );
}

export function StackedHead({ children }: { children: ReactNode }) {
  return <thead role="rowgroup">{children}</thead>;
}

export function StackedBody({ children }: { children: ReactNode }) {
  return <tbody role="rowgroup">{children}</tbody>;
}

export function StackedRow({
  children,
  ...rest
}: { children: ReactNode } & React.ComponentProps<"tr">) {
  return (
    <tr role="row" {...rest}>
      {children}
    </tr>
  );
}

export function StackedHeader({
  children,
  ...rest
}: { children: ReactNode } & React.ComponentProps<"th">) {
  return (
    <th role="columnheader" {...rest}>
      {children}
    </th>
  );
}

export function StackedCell({
  label,
  children,
  ...rest
}: {
  /** The column this cell belongs to, shown beside the value on a phone. */
  label: string;
  children: ReactNode;
} & React.ComponentProps<"td">) {
  return (
    <td role="cell" data-label={label} {...rest}>
      {children}
    </td>
  );
}

/** A full-width "nothing here" row, which gets no label of its own. */
export function StackedEmpty({
  colSpan,
  children,
}: {
  colSpan: number;
  children: ReactNode;
}) {
  return (
    <tr role="row">
      <td
        role="cell"
        colSpan={colSpan}
        className="pickl-stacked-empty text-muted text-center"
      >
        {children}
      </td>
    </tr>
  );
}
