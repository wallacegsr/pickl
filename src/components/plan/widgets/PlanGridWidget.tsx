"use client";

import { Badge, Button, Table } from "react-bootstrap";
import { useResizableColumns, type ColumnSpec } from "@/components/plan/useResizableColumns";
import type { MealType } from "@/db/schema";
import { usePlanContext, type ExternalEventView } from "../PlanContext";

const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner"];
const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

/** How many events a day shows before collapsing the rest behind a count. */
const OVERLAY_VISIBLE_LIMIT = 3;

/** "6:30 PM", in the viewer's locale. All-day events have no time at all. */
export function formatEventTime(event: ExternalEventView): string | null {
  if (event.allDay || !event.start) return null;
  const d = new Date(event.start);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * The Sunday–Saturday meal grid, including the external-calendar column.
 *
 * Unchanged from the pre-dashboard /plan page apart from where its state
 * comes from. In particular the overlay column still renders from whatever
 * `overlayByDate` currently holds, which is an empty map until the
 * post-paint fetch resolves — the grid is complete on first paint whether or
 * not a calendar is reachable, and a hung provider changes nothing here.
 */
export default function PlanGridWidget() {
  const {
    days,
    today,
    isEditable,
    openSlotEditor,
    overlayApplies,
    overlay,
    overlayByDate,
    expandedOverlayDates,
    expandOverlayDate,
    collapseOverlayDate,
  } = usePlanContext();

  // Day is deliberately the narrowest: it holds "Wednesday" and a date, and
  // every pixel it does not need is a pixel a recipe name can use.
  const columns: ColumnSpec[] = overlayApplies
    ? [
        { key: "day", defaultRatio: 0.13 },
        { key: "breakfast", defaultRatio: 0.2233 },
        { key: "lunch", defaultRatio: 0.2233 },
        { key: "dinner", defaultRatio: 0.2234 },
        { key: "overlay", defaultRatio: 0.2 },
      ]
    : [
        { key: "day", defaultRatio: 0.14 },
        { key: "breakfast", defaultRatio: 0.2866 },
        { key: "lunch", defaultRatio: 0.2867 },
        { key: "dinner", defaultRatio: 0.2867 },
      ];
  const { tableRef, widths, startResize, nudge, reset } =
    useResizableColumns(columns);

  /** The grabber sitting on a column's right-hand edge. */
  const handleFor = (index: number, label: string) =>
    index < columns.length - 1 ? (
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize the ${label} column`}
        tabIndex={0}
        className="pickl-col-resizer"
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          startResize(index, e.clientX);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          reset();
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 40 : 12;
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            nudge(index, -step);
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            nudge(index, step);
          } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            reset();
          }
        }}
      />
    ) : null;

  return (
    <div className="table-responsive">
      <Table
        bordered
        hover
        ref={tableRef}
        // Fixed layout is what makes the <col> widths authoritative; with the
        // default auto layout the browser re-derives widths from content and
        // a drag appears to do nothing.
        className={`align-middle${widths ? " pickl-plan-table-fixed" : ""}`}
      >
        {widths && (
          <colgroup>
            {columns.map((c) => (
              <col key={c.key} style={{ width: widths[c.key] }} />
            ))}
          </colgroup>
        )}
        <thead>
          <tr>
            <th className="pickl-col-head">
              Day
              {handleFor(0, "Day")}
            </th>
            {MEAL_TYPES.map((mt, i) => (
              <th key={mt} className="pickl-col-head">
                {MEAL_LABELS[mt]}
                {handleFor(i + 1, MEAL_LABELS[mt])}
              </th>
            ))}
            {overlayApplies && (
              <th className="pickl-col-head">
                On your calendar
                <div className="fw-normal small text-body-secondary">
                  Only you see this
                </div>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {days.map((day) => {
            const isToday = day.date === today;
            return (
              <tr key={day.date} className={isToday ? "table-warning" : undefined}>
                <td>
                  <div className="fw-semibold">
                    {day.dayOfWeek}
                    {isToday && (
                      <Badge bg="warning" text="dark" className="ms-2">
                        Today
                      </Badge>
                    )}
                  </div>
                  <div className="small text-muted">{day.date}</div>
                </td>
                {MEAL_TYPES.map((mt) => {
                  const slot = day.meals[mt];
                  return (
                    <td
                      key={mt}
                      role={isEditable ? "button" : undefined}
                      onClick={() => openSlotEditor(day, mt)}
                      style={{ cursor: isEditable ? "pointer" : "default" }}
                    >
                      {slot?.recipe ? (
                        slot.recipe.name
                      ) : (
                        <span className="text-muted fst-italic">Empty jar</span>
                      )}
                    </td>
                  );
                })}
                {overlayApplies && (
                  <td>
                    {/* The scroll container is this div, not the <td>:
                        table cells ignore max-height, so a busy day put
                        on the cell itself would silently grow the row. */}
                    <div className="plan-external-cell">
                      {(() => {
                        const events = overlayByDate.get(day.date) ?? [];
                        if (events.length === 0) {
                          // Not "Empty jar" — an empty day on your calendar
                          // is not an unplanned meal, and the two must never
                          // read as the same kind of blank.
                          return <span className="small text-body-secondary">—</span>;
                        }
                        const expanded = expandedOverlayDates.includes(day.date);
                        const shown = expanded
                          ? events
                          : events.slice(0, OVERLAY_VISIBLE_LIMIT);
                        const hidden = events.length - shown.length;
                        return (
                          <>
                            {shown.map((event) => {
                              const time = formatEventTime(event);
                              return (
                                <div
                                  key={event.id}
                                  className="plan-external-event"
                                  title={event.summary}
                                >
                                  <span className="plan-external-event-time" suppressHydrationWarning>
                                    {event.allDay
                                      ? event.multiDay
                                        ? "Multi-day"
                                        : "All day"
                                      : time ?? ""}
                                  </span>{" "}
                                  <span className="plan-external-event-title">
                                    {event.summary}
                                  </span>
                                </div>
                              );
                            })}
                            {hidden > 0 && (
                              <Button
                                variant="link"
                                size="sm"
                                className="p-0 small text-decoration-none"
                                onClick={() => expandOverlayDate(day.date)}
                              >
                                +{hidden} more
                              </Button>
                            )}
                            {expanded && events.length > OVERLAY_VISIBLE_LIMIT && (
                              <Button
                                variant="link"
                                size="sm"
                                className="p-0 small text-decoration-none"
                                onClick={() => collapseOverlayDate(day.date)}
                              >
                                Show fewer
                              </Button>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </Table>

      {/* The overlay's failure mode, stated quietly and inline. The grid
          above has already rendered in full by the time this can appear —
          it is a footnote about a missing decoration, not an error. */}
      {overlayApplies && overlay && overlay.status !== "ok" && overlay.message && (
        <div className="small text-body-secondary mb-1">{overlay.message}</div>
      )}
    </div>
  );
}
