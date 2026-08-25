"use client";

import { useMemo } from "react";
import {
  GridLayout,
  useContainerWidth,
  type Layout,
} from "react-grid-layout";
import WidgetFrame from "./WidgetFrame";
import {
  DASHBOARD_COLS,
  DASHBOARD_MARGIN,
  DASHBOARD_ROW_HEIGHT,
  WIDGET_REGISTRY,
  visibleWidgetsInReadingOrder,
  type DashboardLayout,
  type WidgetId,
} from "@/lib/dashboard/widgets";

/**
 * The draggable/resizable board. Imported only via
 * `dynamic(..., { ssr: false })` — react-grid-layout measures the DOM and has
 * no server rendering to speak of.
 *
 * Using the plain `GridLayout` rather than `ResponsiveGridLayout` is
 * deliberate. The responsive component's job is to keep one layout per
 * breakpoint and reflow between them, but this dashboard does not reflow on a
 * phone — below DASHBOARD_STACK_BREAKPOINT it stops being a grid at all and
 * becomes a stacked list (see PlanDashboard). So there is exactly one stored
 * layout, one set of columns, and nothing for the breakpoint machinery to do.
 *
 * v2 replaced the WidthProvider HOC with the useContainerWidth hook; that is
 * what supplies the required `width` prop here.
 */
export default function DashboardGrid({
  layout,
  editing,
  onLayoutChange,
  onLayoutCommit,
  onRemove,
  onMove,
}: {
  layout: DashboardLayout;
  editing: boolean;
  onLayoutChange: (next: Layout) => void;
  /** Fired only when the user finishes a drag or resize — see below. */
  onLayoutCommit: (next: Layout) => void;
  onRemove: (id: WidgetId) => void;
  onMove: (id: WidgetId, direction: -1 | 1) => void;
}) {
  const { width, containerRef } = useContainerWidth({ initialWidth: 1140 });

  const rglLayout: Layout = useMemo(
    () =>
      layout.items.map((item) => ({
        i: item.i,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        minW: WIDGET_REGISTRY[item.i].minW,
        minH: WIDGET_REGISTRY[item.i].minH,
      })),
    [layout.items]
  );

  const order = useMemo(() => visibleWidgetsInReadingOrder(layout), [layout]);
  const indexOf = new Map(order.map((item, index) => [item.i, index]));

  return (
    // The hook types its ref as RefObject<HTMLDivElement | null> (React 19's
    // shape); React 18's `ref` prop still wants RefObject<HTMLDivElement>.
    // Same object either way — only the nullability annotation differs.
    <div ref={containerRef as React.RefObject<HTMLDivElement>}>
      <GridLayout
        width={width}
        layout={rglLayout}
        onLayoutChange={onLayoutChange}
        // Persistence hangs off drag/resize *stop*, never off onLayoutChange.
        // react-grid-layout also fires onLayoutChange when it reflows the
        // board itself (on mount, and whenever the container width changes),
        // and saving those would let a layout nobody touched overwrite the
        // one the user arranged — which also made "Reset to default" appear
        // not to work, because the reflow re-saved over it immediately.
        onDragStop={onLayoutCommit}
        onResizeStop={onLayoutCommit}
        gridConfig={{
          cols: DASHBOARD_COLS,
          rowHeight: DASHBOARD_ROW_HEIGHT,
          margin: DASHBOARD_MARGIN,
          // Zero container padding keeps the widget boxes flush with the rest
          // of the page's column, and keeps the pre-mount static positioning
          // in PlanDashboard an exact match for what react-grid-layout does.
          containerPadding: [0, 0],
        }}
        dragConfig={{
          enabled: true,
          bounded: false,
          // Only the title bar starts a drag, so every control inside a
          // widget — checkboxes, the search box, the export buttons — keeps
          // working normally.
          handle: ".pickl-widget-handle",
          cancel: "button, input, select, textarea, a, .btn",
          threshold: 3,
        }}
        resizeConfig={{ enabled: true, handles: ["se"] }}
        className="pickl-dashboard-grid"
      >
        {layout.items.map((item) => {
          const index = indexOf.get(item.i) ?? 0;
          return (
            <div key={item.i}>
              <WidgetFrame
                id={item.i}
                editing={editing}
                draggable
                canMoveUp={index > 0}
                canMoveDown={index < order.length - 1}
                onMoveUp={() => onMove(item.i, -1)}
                onMoveDown={() => onMove(item.i, 1)}
                onRemove={() => onRemove(item.i)}
              />
            </div>
          );
        })}
      </GridLayout>
    </div>
  );
}
