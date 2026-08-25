"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Button, Dropdown } from "react-bootstrap";
import type { Layout } from "react-grid-layout";
import WidgetFrame from "./WidgetFrame";
import {
  DASHBOARD_COLS,
  DASHBOARD_MARGIN,
  DASHBOARD_ROW_HEIGHT,
  DASHBOARD_STACK_BREAKPOINT,
  addWidget,
  availableWidgets,
  moveWidget,
  reconcileLayout,
  removeWidget,
  visibleWidgetsInReadingOrder,
  type DashboardLayout,
  type WidgetId,
} from "@/lib/dashboard/widgets";

/**
 * react-grid-layout is client-only: it measures the DOM to size itself and
 * has nothing useful to render on a server. Loading it through
 * `dynamic(..., { ssr: false })` keeps it out of the server bundle entirely,
 * so there is no server/client markup to disagree about and no hydration
 * warning to suppress.
 *
 * The usual cost of ssr:false is a hole in the page until the chunk arrives.
 * That is avoided here rather than papered over with a spinner: see
 * StaticBoard below, which draws the *same* board from the same saved
 * geometry using plain CSS. The dynamic component swaps in on top of an
 * already-correct picture, so nothing moves.
 */
const DashboardGrid = dynamic(() => import("./DashboardGrid"), {
  ssr: false,
});

const [MARGIN_X, MARGIN_Y] = DASHBOARD_MARGIN;

/**
 * The geometry react-grid-layout will use, expressed in CSS.
 *
 * These two formulas are react-grid-layout's own, transcribed: an item's
 * width is `w * (containerWidth + marginX) / cols - marginX`, and with
 * containerPadding zeroed its left is the same expression over `x`. Writing
 * the horizontal terms as `calc()` over `100%` means the browser can solve
 * them without anybody measuring the container, which is what lets the
 * pre-hydration render land on exactly the pixels the grid will use.
 */
function staticItemStyle(item: {
  x: number;
  y: number;
  w: number;
  h: number;
}): React.CSSProperties {
  return {
    position: "absolute",
    left: `calc((100% + ${MARGIN_X}px) * ${item.x / DASHBOARD_COLS})`,
    width: `calc((100% + ${MARGIN_X}px) * ${item.w / DASHBOARD_COLS} - ${MARGIN_X}px)`,
    top: item.y * (DASHBOARD_ROW_HEIGHT + MARGIN_Y),
    height: item.h * (DASHBOARD_ROW_HEIGHT + MARGIN_Y) - MARGIN_Y,
  };
}

/**
 * The board before react-grid-layout has loaded — and, below the stacking
 * breakpoint, a description of what CSS should do rather than JS: the media
 * query in pickl-bootstrap.scss unsets the absolute positioning here, so the
 * very same markup is a stacked list on a phone and a positioned board on a
 * desktop, with no measurement and therefore nothing to flash.
 */
function StaticBoard({ layout }: { layout: DashboardLayout }) {
  const height = layout.items.reduce(
    (max, item) =>
      Math.max(max, (item.y + item.h) * (DASHBOARD_ROW_HEIGHT + MARGIN_Y) - MARGIN_Y),
    0
  );
  return (
    <div className="pickl-dashboard-static" style={{ height }}>
      {visibleWidgetsInReadingOrder(layout).map((item) => (
        <div
          key={item.i}
          className="pickl-dashboard-static-item"
          style={staticItemStyle(item)}
        >
          <WidgetFrame id={item.i} editing={false} />
        </div>
      ))}
    </div>
  );
}

/** The phone rendering: reading order, one after another, nothing draggable. */
function StackedBoard({
  layout,
  editing,
  onRemove,
  onMove,
}: {
  layout: DashboardLayout;
  editing: boolean;
  onRemove: (id: WidgetId) => void;
  onMove: (id: WidgetId, direction: -1 | 1) => void;
}) {
  const order = visibleWidgetsInReadingOrder(layout);
  return (
    <div className="pickl-dashboard-stack">
      {order.map((item, index) => (
        <WidgetFrame
          key={item.i}
          id={item.i}
          editing={editing}
          canMoveUp={index > 0}
          canMoveDown={index < order.length - 1}
          onMoveUp={() => onMove(item.i, -1)}
          onMoveDown={() => onMove(item.i, 1)}
          onRemove={() => onRemove(item.i)}
        />
      ))}
    </div>
  );
}

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * The configurable /plan board: a toolbar, and either a draggable grid
 * (desktop) or a stacked list (phone).
 *
 * Three renderings, one source of geometry:
 *
 *  - before hydration, StaticBoard positions widgets with CSS `calc()`;
 *  - on a narrow viewport, StackedBoard renders them in reading order with
 *    no drag targets at all — a drag-and-drop grid on a 375px screen is a
 *    way to lose a widget behind another one, not a feature;
 *  - otherwise DashboardGrid hands the same geometry to react-grid-layout.
 *
 * The board's shape is only ever changed by the user, and every change is
 * persisted to /api/dashboard/layout, which derives the owner from the
 * session. Nothing here sends a user id.
 */
export default function PlanDashboard({
  initialLayout,
}: {
  /**
   * The reconciled layout from the server render, so the first paint is
   * already the user's own board — no fetch, no spinner, no rearrangement
   * once it arrives.
   */
  initialLayout: DashboardLayout;
}) {
  const [layout, setLayout] = useState<DashboardLayout>(initialLayout);
  const [editing, setEditing] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // Hydration-safe viewport test: `narrow` starts as null (meaning "not
  // measured yet"), so the server render and the first client render agree,
  // and the real answer only ever changes state after mount.
  const [narrow, setNarrow] = useState<boolean | null>(null);
  useEffect(() => {
    const query = window.matchMedia(
      `(max-width: ${DASHBOARD_STACK_BREAKPOINT - 0.02}px)`
    );
    const apply = () => setNarrow(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  /**
   * Keeps StaticBoard on screen until the grid's chunk has actually arrived.
   * Without this, `dynamic` renders nothing while it fetches and the board
   * blinks out for a frame or two — swapping a correct static picture for a
   * hole is worse than the hole ssr:false was meant to avoid.
   */
  const [gridReady, setGridReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    import("./DashboardGrid")
      .then(() => {
        if (!cancelled) setGridReady(true);
      })
      .catch(() => {
        /* Static board stays; it is a complete rendering on its own. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<DashboardLayout | null>(null);

  const flush = useCallback(async () => {
    const next = pending.current;
    pending.current = null;
    if (!next) return;
    setSaveState("saving");
    try {
      const res = await fetch("/api/dashboard/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // No userId. The endpoint takes the owner from the session and
        // ignores anything else, so there is nothing useful to send.
        body: JSON.stringify({ items: next.items, hidden: next.hidden }),
      });
      setSaveState(res.ok ? "saved" : "error");
    } catch {
      setSaveState("error");
    }
  }, []);

  /**
   * Dragging emits a stream of layouts; a debounce keeps that to one write
   * per gesture rather than one per frame. Add/remove/reset call the API
   * directly instead, since those are single deliberate acts.
   */
  const queueSave = useCallback(
    (next: DashboardLayout) => {
      pending.current = next;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, 700);
    },
    [flush]
  );

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    []
  );

  const applyAndSave = useCallback(
    (next: DashboardLayout) => {
      setLayout(next);
      queueSave(next);
    },
    [queueSave]
  );

  const mergeGridLayout = useCallback(
    (next: Layout): DashboardLayout =>
      reconcileLayout({
        v: 1,
        items: next.map((item) => ({
          i: item.i,
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
        })),
        hidden: layout.hidden,
      }),
    [layout.hidden]
  );

  /**
   * Live geometry while a drag or resize is in flight, and whenever
   * react-grid-layout reflows the board on its own. Updates local state only —
   * deliberately does NOT persist.
   */
  const handleGridLayoutChange = useCallback(
    (next: Layout) => {
      const merged = mergeGridLayout(next);
      if (sameGeometry(layout, merged)) return;
      setLayout(merged);
    },
    [layout, mergeGridLayout]
  );

  /**
   * The user let go of a widget. This is the only path that writes a grid
   * arrangement back to the server.
   *
   * Persisting from onLayoutChange instead looks equivalent but is not:
   * react-grid-layout also fires it when it reflows the board itself — on
   * mount, and on any container width change — so merely opening the page (or
   * resizing the window) would save a layout the user never chose, on top of
   * the one they did. It also made "Reset to default" look broken: the reset
   * landed, then the very next reflow saved over it.
   */
  const handleGridLayoutCommit = useCallback(
    (next: Layout) => {
      const merged = mergeGridLayout(next);
      if (sameGeometry(layout, merged)) return;
      setLayout(merged);
      queueSave(merged);
    },
    [layout, mergeGridLayout, queueSave]
  );

  const handleRemove = useCallback(
    (id: WidgetId) => applyAndSave(removeWidget(layout, id)),
    [applyAndSave, layout]
  );
  const handleAdd = useCallback(
    (id: WidgetId) => applyAndSave(addWidget(layout, id)),
    [applyAndSave, layout]
  );
  const handleMove = useCallback(
    (id: WidgetId, direction: -1 | 1) =>
      applyAndSave(moveWidget(layout, id, direction)),
    [applyAndSave, layout]
  );

  const handleReset = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pending.current = null;
    setSaveState("saving");
    try {
      const res = await fetch("/api/dashboard/layout", { method: "DELETE" });
      if (!res.ok) throw new Error("reset failed");
      const data = await res.json();
      setLayout(reconcileLayout(data.layout));
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, []);

  const addable = availableWidgets(layout);

  return (
    <div className="pickl-dashboard">
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <Button
          variant={editing ? "primary" : "outline-secondary"}
          size="sm"
          onClick={() => setEditing((v) => !v)}
          aria-pressed={editing}
        >
          {editing ? "Done editing" : "Edit layout"}
        </Button>

        <Dropdown>
          <Dropdown.Toggle
            variant="outline-secondary"
            size="sm"
            id="dashboard-add-widget"
            disabled={addable.length === 0}
          >
            Add widget
          </Dropdown.Toggle>
          <Dropdown.Menu>
            {addable.map((meta) => (
              <Dropdown.Item key={meta.id} onClick={() => handleAdd(meta.id)}>
                <div className="fw-semibold">{meta.title}</div>
                <div className="small text-body-secondary">{meta.description}</div>
              </Dropdown.Item>
            ))}
            {addable.length === 0 && (
              <Dropdown.ItemText className="small text-body-secondary">
                Every widget is already on the board.
              </Dropdown.ItemText>
            )}
          </Dropdown.Menu>
        </Dropdown>

        <Button variant="outline-secondary" size="sm" onClick={handleReset}>
          Reset to default
        </Button>

        <span className="small text-body-secondary" role="status" aria-live="polite">
          {saveState === "saving" && "Saving layout…"}
          {saveState === "saved" && "Layout saved."}
          {saveState === "error" && "Couldn't save your layout."}
        </span>
      </div>

      {editing && (
        <p className="small text-body-secondary">
          {narrow === false
            ? "Drag a widget by its title bar to move it, or drag its bottom-right corner to resize. The ↑ ↓ buttons do the same thing from the keyboard."
            : "Use the ↑ ↓ buttons to reorder widgets."}{" "}
          <strong>Hiding a widget doesn&apos;t delete anything</strong> — your
          meals, ticked ingredients and recipes all stay exactly as they are,
          and you can put the widget back from <em>Add widget</em>.
        </p>
      )}

      {layout.items.length === 0 ? (
        <div className="border rounded p-4 text-center">
          <p className="mb-2">
            You&apos;ve hidden every widget. Nothing has been deleted — your
            plan is still there.
          </p>
          <Button variant="primary" size="sm" onClick={handleReset}>
            Reset to default
          </Button>
        </div>
      ) : narrow === null || (!narrow && !gridReady) ? (
        <StaticBoard layout={layout} />
      ) : narrow ? (
        <StackedBoard
          layout={layout}
          editing={editing}
          onRemove={handleRemove}
          onMove={handleMove}
        />
      ) : (
        <DashboardGrid
          layout={layout}
          editing={editing}
          onLayoutChange={handleGridLayoutChange}
          onLayoutCommit={handleGridLayoutCommit}
          onRemove={handleRemove}
          onMove={handleMove}
        />
      )}
    </div>
  );
}

function sameGeometry(a: DashboardLayout, b: DashboardLayout): boolean {
  if (a.items.length !== b.items.length) return false;
  const byId = new Map(a.items.map((item) => [item.i, item]));
  return b.items.every((item) => {
    const other = byId.get(item.i);
    return (
      !!other &&
      other.x === item.x &&
      other.y === item.y &&
      other.w === item.w &&
      other.h === item.h
    );
  });
}
