"use client";

import { Fragment, useState, type ReactNode } from "react";
import { Button, Modal } from "react-bootstrap";
import type { ExternalEventView } from "./PlanContext";

/** "6:30 PM", in the viewer's locale. All-day events have no time at all. */
export function formatEventTime(event: ExternalEventView): string | null {
  if (event.allDay || !event.start) return null;
  const d = new Date(event.start);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * One event from the viewer's own calendar: the compact row the grid and the
 * calendar widget draw, as a button that opens a window with the details —
 * when it is, where, the notes, and a link to open it in Google Calendar.
 *
 * Everything here arrived with the page's one overlay fetch; opening an
 * event asks the server for nothing more. The window is a portal, so the
 * dashboard grid's transforms and a table cell's scroll box don't clip it.
 */
export default function ExternalEventItem({ event }: { event: ExternalEventView }) {
  const [open, setOpen] = useState(false);
  const time = formatEventTime(event);

  return (
    <>
      <button
        type="button"
        className="plan-external-event plan-external-event-button"
        title={`${event.summary} — show details`}
        onClick={() => setOpen(true)}
      >
        <span className="plan-external-event-time" suppressHydrationWarning>
          {event.allDay ? (event.multiDay ? "Multi-day" : "All day") : time ?? ""}
        </span>{" "}
        <span className="plan-external-event-title">{event.summary}</span>
      </button>

      <Modal show={open} onHide={() => setOpen(false)} centered scrollable>
        <Modal.Header closeButton>
          <Modal.Title as="h2" className="h5 text-break">
            {event.summary}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <dl className="mb-0">
            <dt className="small text-body-secondary fw-semibold">When</dt>
            <dd suppressHydrationWarning>{describeWhen(event)}</dd>

            {event.location && (
              <>
                <dt className="small text-body-secondary fw-semibold">Where</dt>
                <dd className="text-break">
                  {event.location}{" "}
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="small text-nowrap"
                  >
                    Map ↗
                  </a>
                </dd>
              </>
            )}

            {event.description && (
              <>
                <dt className="small text-body-secondary fw-semibold">Notes</dt>
                <dd className="text-break" style={{ whiteSpace: "pre-wrap" }}>
                  {linkify(plainText(event.description))}
                </dd>
              </>
            )}
          </dl>
          <p className="small text-body-secondary mt-3 mb-0">
            From your own calendar. Only you see this, and Pickl doesn&apos;t keep it.
          </p>
        </Modal.Body>
        <Modal.Footer>
          {event.link && (
            <Button
              as="a"
              href={event.link}
              target="_blank"
              rel="noopener noreferrer"
              variant="outline-secondary"
              className="me-auto"
            >
              Open in Google Calendar ↗
            </Button>
          )}
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}

/** "Tuesday, September 15 · 6:30 – 7:45 PM", or "All day" forms. */
function describeWhen(event: ExternalEventView): string {
  const dayOf = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const timeOf = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  // A plain date string parsed as local noon, so it never slips a day.
  const dateOnly = dayOf(`${event.date}T12:00:00`);

  if (event.allDay || !event.start) {
    return event.multiDay ? `${dateOnly} · All day (part of a multi-day event)` : `${dateOnly} · All day`;
  }
  const start = new Date(event.start);
  const end = event.end ? new Date(event.end) : null;
  if (Number.isNaN(start.getTime())) return dateOnly;
  if (!end || Number.isNaN(end.getTime()) || end.getTime() === start.getTime()) {
    return `${dayOf(event.start)} · ${timeOf(event.start)}`;
  }
  if (start.toDateString() !== end.toDateString()) {
    return `${dayOf(event.start)} ${timeOf(event.start)} – ${dayOf(event.end!)} ${timeOf(event.end!)}`;
  }
  return `${dayOf(event.start)} · ${timeOf(event.start)} – ${timeOf(event.end!)}`;
}

/**
 * Google event notes are often HTML. They are shown as TEXT, never injected:
 * line-breaking tags become newlines, the rest are dropped, and entities are
 * decoded by a parser that is never attached to the page.
 */
function plainText(raw: string): string {
  if (!/[<&]/.test(raw)) return raw;
  const withBreaks = raw
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d)>/gi, "\n");
  const doc = new DOMParser().parseFromString(withBreaks, "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Web addresses in the notes become links; everything else stays text. */
function linkify(text: string): ReactNode {
  const parts = text.split(/(https?:\/\/[^\s<>"]+)/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer">
        {part}
      </a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  );
}
