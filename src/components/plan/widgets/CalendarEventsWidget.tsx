"use client";

import Link from "next/link";
import { Spinner } from "react-bootstrap";
import { usePlanContext } from "../PlanContext";
import { formatEventTime } from "./PlanGridWidget";

/**
 * This week's external calendar events as a standalone widget.
 *
 * It renders the same fetched data as the grid's overlay column and starts
 * no request of its own — the single post-paint fetch in PlanView is shared,
 * so placing this widget cannot make the page do more calendar work, and
 * removing it cannot make the grid's column stop working.
 *
 * The privacy rules are the same ones the overlay has always had, and they
 * are not re-decided here: `overlayEnabled` is the viewer's own opt-in read
 * from their own row, and `overlayApplies` additionally requires that the
 * plan on screen is one the viewer is allowed to see an overlay for. Both
 * are re-checked server-side in src/lib/calendar/read.ts before a calendar
 * is touched. Nothing on this path is persisted.
 *
 * Every "we have nothing to show" case below is a plain sentence, never an
 * error: the overlay is a decoration, and a widget that shouted about a
 * calendar being unreachable would be worse than one that says so quietly.
 */
export default function CalendarEventsWidget() {
  const { overlayEnabled, overlayApplies, overlay, days } = usePlanContext();

  if (!overlayEnabled) {
    return (
      <div className="text-body-secondary">
        <p className="mb-2">
          Your calendar overlay is switched off, so there&apos;s nothing to show
          here.
        </p>
        <p className="small mb-0">
          Turn it on under{" "}
          <Link href="/preferences">Preferences → Calendar</Link>. Only you ever
          see your own events.
        </p>
      </div>
    );
  }

  if (!overlayApplies) {
    return (
      <p className="text-body-secondary mb-0">
        Your calendar isn&apos;t shown next to someone else&apos;s private plan.
      </p>
    );
  }

  if (!overlay) {
    return (
      <div className="text-body-secondary d-flex align-items-center gap-2">
        <Spinner animation="border" size="sm" role="status" aria-hidden="true" />
        <span>Checking your calendar…</span>
      </div>
    );
  }

  if (overlay.status !== "ok") {
    return (
      <p className="text-body-secondary mb-0">
        {overlay.message ?? "Your calendar events aren't available right now."}
      </p>
    );
  }

  const byDate = new Map<string, typeof overlay.events>();
  for (const event of overlay.events) {
    const list = byDate.get(event.date);
    if (list) list.push(event);
    else byDate.set(event.date, [event]);
  }

  const daysWithEvents = days.filter((day) => (byDate.get(day.date) ?? []).length > 0);

  if (daysWithEvents.length === 0) {
    return (
      <p className="text-body-secondary mb-0">
        Nothing on your calendar this week.
      </p>
    );
  }

  return (
    <div>
      <p className="small text-body-secondary mb-2">Only you see this.</p>
      {daysWithEvents.map((day) => (
        <div key={day.date} className="mb-3">
          <div className="fw-semibold small border-bottom pb-1 mb-1">
            {day.dayOfWeek}{" "}
            <span className="text-body-secondary fw-normal">({day.date})</span>
          </div>
          {(byDate.get(day.date) ?? []).map((event) => {
            const time = formatEventTime(event);
            return (
              <div
                key={event.id}
                className="plan-external-event"
                title={event.summary}
              >
                <span className="plan-external-event-time">
                  {event.allDay
                    ? event.multiDay
                      ? "Multi-day"
                      : "All day"
                    : time ?? ""}
                </span>{" "}
                <span className="plan-external-event-title">{event.summary}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
