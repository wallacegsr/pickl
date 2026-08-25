"use client";

import { Button } from "react-bootstrap";
import { usePlanContext } from "@/components/plan/PlanContext";

/**
 * Export actions for the meal plan, pinned to the bottom of the Meal plan
 * widget.
 *
 * These used to sit in the page chrome above the board. They belong to the
 * plan itself — they export whatever week and scope the grid is showing — so
 * they live with it. Rendered as a Card.Footer *outside* the widget's
 * scrolling body, so they stay put rather than scrolling away with a long
 * week.
 */
export default function PlanExportFooter() {
  const { week, scope, requestedUserId } = usePlanContext();

  const params = new URLSearchParams({ week, scope });
  if (scope === "private") params.set("userId", requestedUserId);
  const qs = params.toString();

  return (
    <div className="d-flex flex-wrap gap-2 align-items-center">
      <span className="text-body-secondary small me-1">Export this week:</span>
      <Button
        size="sm"
        variant="outline-secondary"
        href={`/api/export/json?${qs}`}
        target="_blank"
        title="Download this week's plan as JSON, one entry per planned meal."
      >
        JSON
      </Button>
      <Button
        size="sm"
        variant="outline-secondary"
        href={`/api/export/ical?${qs}`}
        target="_blank"
        title="Download this week's plan as an .ics calendar file you can import anywhere."
      >
        iCal
      </Button>
    </div>
  );
}
