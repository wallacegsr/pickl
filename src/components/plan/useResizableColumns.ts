"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Drag-to-resize widths for the meal plan's table columns.
 *
 * Widths live in localStorage rather than the database, unlike the dashboard
 * layout. A good column width depends on how wide the window is, so a setting
 * that followed you from a desktop to a phone would be actively wrong; the
 * dashboard layout already collapses to a stacked list on small screens, but
 * column widths have no such escape hatch.
 *
 * Stored per column-set: turning the calendar overlay on adds a fifth column,
 * and widths chosen for four should not be reinterpreted as widths for five.
 */

const STORAGE_PREFIX = "pickl-plan-columns-v1";

/** Nothing may be dragged narrower than this. */
const MIN_WIDTH = 72;

export interface ColumnSpec {
  key: string;
  /** Share of the table this column gets before anyone drags anything. */
  defaultRatio: number;
}

function storageKey(keys: string[]) {
  return `${STORAGE_PREFIX}:${keys.join(",")}`;
}

function readStored(keys: string[]): Record<string, number> | null {
  try {
    const raw = window.localStorage.getItem(storageKey(keys));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const k of keys) {
      const v = parsed[k];
      if (typeof v !== "number" || !Number.isFinite(v) || v < MIN_WIDTH) return null;
      out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

export function useResizableColumns(columns: ColumnSpec[]) {
  const keys = columns.map((c) => c.key);
  const keySig = keys.join(",");
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [widths, setWidths] = useState<Record<string, number> | null>(null);

  /** Default px widths derived from however wide the table currently is. */
  const computeDefaults = useCallback(
    (total: number): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const c of columns) {
        out[c.key] = Math.max(MIN_WIDTH, Math.round(total * c.defaultRatio));
      }
      return out;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keySig]
  );

  // Initialise from storage, falling back to ratios of the measured width.
  useEffect(() => {
    const stored = readStored(keys);
    if (stored) {
      setWidths(stored);
      return;
    }
    const total = tableRef.current?.parentElement?.clientWidth ?? 0;
    setWidths(total > 0 ? computeDefaults(total) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keySig, computeDefaults]);

  const persist = useCallback(
    (next: Record<string, number>) => {
      try {
        window.localStorage.setItem(storageKey(keys), JSON.stringify(next));
      } catch {
        // Private browsing, quota, etc. The widths still work for this visit.
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keySig]
  );

  /**
   * Dragging the divider after column `index` grows it and shrinks the next
   * one by the same amount, so the table's overall width never changes and
   * the columns to the right stay put. Both ends clamp at MIN_WIDTH, which is
   * what stops a drag from collapsing a neighbour to nothing.
   */
  const startResize = useCallback(
    (index: number, startX: number) => {
      const current = widths;
      if (!current) return;
      const leftKey = keys[index];
      const rightKey = keys[index + 1];
      if (!rightKey) return;
      const startLeft = current[leftKey];
      const startRight = current[rightKey];

      const move = (clientX: number) => {
        const rawDelta = clientX - startX;
        const delta = Math.max(
          MIN_WIDTH - startLeft,
          Math.min(startRight - MIN_WIDTH, rawDelta)
        );
        setWidths((prev) =>
          prev
            ? { ...prev, [leftKey]: startLeft + delta, [rightKey]: startRight - delta }
            : prev
        );
      };

      const onPointerMove = (e: PointerEvent) => move(e.clientX);
      const onPointerUp = (e: PointerEvent) => {
        move(e.clientX);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        document.body.classList.remove("pickl-col-resizing");
        setWidths((prev) => {
          if (prev) persist(prev);
          return prev;
        });
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      document.body.classList.add("pickl-col-resizing");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [widths, keySig, persist]
  );

  /** Keyboard equivalent, so resizing is not mouse-only. */
  const nudge = useCallback(
    (index: number, amount: number) => {
      setWidths((prev) => {
        if (!prev) return prev;
        const leftKey = keys[index];
        const rightKey = keys[index + 1];
        if (!rightKey) return prev;
        const delta = Math.max(
          MIN_WIDTH - prev[leftKey],
          Math.min(prev[rightKey] - MIN_WIDTH, amount)
        );
        const next = {
          ...prev,
          [leftKey]: prev[leftKey] + delta,
          [rightKey]: prev[rightKey] - delta,
        };
        persist(next);
        return next;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keySig, persist]
  );

  const reset = useCallback(() => {
    const total = tableRef.current?.parentElement?.clientWidth ?? 0;
    if (total <= 0) return;
    const next = computeDefaults(total);
    setWidths(next);
    persist(next);
  }, [computeDefaults, persist]);

  return { tableRef, widths, startResize, nudge, reset };
}
