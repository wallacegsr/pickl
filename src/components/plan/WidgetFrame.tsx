"use client";

import type { ReactNode } from "react";
import { Button, Card } from "react-bootstrap";
import PlanGridWidget from "./widgets/PlanGridWidget";
import ShakeControlsWidget from "./widgets/ShakeControlsWidget";
import ShoppingListWidget from "./widgets/ShoppingListWidget";
import RecipeQuickLookWidget from "./widgets/RecipeQuickLookWidget";
import CalendarEventsWidget from "./widgets/CalendarEventsWidget";
import { WIDGET_REGISTRY, type WidgetId } from "@/lib/dashboard/widgets";

/**
 * The client half of the widget registry: id → component.
 *
 * Kept apart from src/lib/dashboard/widgets.ts so that the metadata half
 * (ids, titles, default geometry, reconciliation) stays free of React and can
 * be imported by the API route and the server render without dragging five
 * client components along with it.
 */
export const WIDGET_COMPONENTS: Record<WidgetId, () => JSX.Element> = {
  "plan-grid": PlanGridWidget,
  "shake-controls": ShakeControlsWidget,
  "shopping-list": ShoppingListWidget,
  "recipe-quick-look": RecipeQuickLookWidget,
  "calendar-events": CalendarEventsWidget,
};

export interface WidgetFrameProps {
  id: WidgetId;
  /**
   * Edit mode exposes the keyboard-operable controls — move earlier, move
   * later, remove. Dragging and resizing are a convenience on top of these,
   * never the only route: everything the mouse can do to the board can be
   * done from these buttons and the Add menu.
   */
  editing: boolean;
  /** False for the first/last widget in reading order. */
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove?: () => void;
  /** Desktop only: the header doubles as the drag handle. */
  draggable?: boolean;
  children?: ReactNode;
}

/**
 * The card around every widget: an accessible name, a title bar that doubles
 * as the drag handle on desktop, and the edit-mode controls.
 *
 * `role="region"` + `aria-label` is what puts each widget in a screen
 * reader's landmark list, so the board is navigable without ever knowing it
 * is a grid.
 */
export default function WidgetFrame({
  id,
  editing,
  canMoveUp = false,
  canMoveDown = false,
  onMoveUp,
  onMoveDown,
  onRemove,
  draggable = false,
  children,
}: WidgetFrameProps) {
  const meta = WIDGET_REGISTRY[id];
  const Component = WIDGET_COMPONENTS[id];

  return (
    <Card className="pickl-widget" role="region" aria-label={meta.title}>
      <Card.Header
        className={`pickl-widget-header${draggable ? " pickl-widget-handle" : ""}`}
      >
        <span className="pickl-widget-title">{meta.title}</span>
        {editing && (
          <span className="pickl-widget-actions">
            <Button
              variant="outline-secondary"
              size="sm"
              // The drag handle sits on this header; without stopping
              // propagation, pressing one of these buttons would also start a
              // drag on the card underneath.
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onClick={onMoveUp}
              disabled={!canMoveUp}
              aria-label={`Move ${meta.title} earlier`}
              title="Move earlier"
            >
              ↑
            </Button>
            <Button
              variant="outline-secondary"
              size="sm"
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onClick={onMoveDown}
              disabled={!canMoveDown}
              aria-label={`Move ${meta.title} later`}
              title="Move later"
            >
              ↓
            </Button>
            <Button
              variant="outline-secondary"
              size="sm"
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onClick={onRemove}
              aria-label={`Hide ${meta.title} from this dashboard`}
              // Says what it does and what it does not do. Removing is a view
              // change; nothing is deleted and the widget can be added back.
              title={`Hide ${meta.title} from this dashboard. Nothing is deleted — you can add it back at any time.`}
            >
              Hide
            </Button>
          </span>
        )}
      </Card.Header>
      <Card.Body className="pickl-widget-body">
        {children ?? <Component />}
      </Card.Body>
    </Card>
  );
}
