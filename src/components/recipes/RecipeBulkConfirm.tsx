"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Modal, Spinner } from "react-bootstrap";
import type { BulkSummary } from "@/lib/recipeBulk";

export type BulkRequest =
  | { action: "delete"; ids: string[] }
  | { action: "copy"; ids: string[]; target: "private" | "shared" };

/**
 * Confirmation for a bulk recipe action — and for single ones, which are just
 * a selection of one.
 *
 * It opens by asking the server what the action WOULD do (a preview that
 * writes nothing), and shows that. So the dialog never describes the action
 * from the browser's own idea of who may delete what; it describes what the
 * code that is about to act has already worked out. Confirming then runs the
 * same call for real.
 *
 * That is what lets the delete warning be specific. Deleting a recipe takes
 * its planned meals with it, past ones included, and those vanish from Past
 * Preserves too — the old single-recipe dialog said only "this cannot be
 * undone", which was true and not the thing anyone needed to know.
 */
export default function RecipeBulkConfirm({
  request,
  onClose,
  onDone,
}: {
  request: BulkRequest | null;
  onClose: () => void;
  onDone: (summary: BulkSummary, request: BulkRequest) => void;
}) {
  const [preview, setPreview] = useState<BulkSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setPreview(null);
    setError(null);
    if (!request) return;

    let cancelled = false;
    (async () => {
      const res = await fetch("/api/recipes/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, preview: true }),
      });
      const body = await res.json().catch(() => null);
      if (cancelled) return;
      if (!res.ok) {
        setError(body?.error ?? "Could not work out what that would do.");
        return;
      }
      setPreview(body as BulkSummary);
    })();

    return () => {
      cancelled = true;
    };
  }, [request]);

  async function confirm() {
    if (!request) return;
    setRunning(true);
    setError(null);
    const res = await fetch("/api/recipes/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const body = await res.json().catch(() => null);
    setRunning(false);
    if (!res.ok) {
      setError(body?.error ?? "That did not work.");
      return;
    }
    onDone(body as BulkSummary, request);
  }

  const isDelete = request?.action === "delete";
  const destination =
    request?.action === "copy"
      ? request.target === "private"
        ? "your Secret Stash"
        : "the House Jar"
      : "";

  const title = !request
    ? ""
    : isDelete
      ? `Delete ${plural(request.ids.length, "recipe")}?`
      : `Copy ${plural(request.ids.length, "recipe")} to ${destination}?`;

  const refused = preview?.rows.filter((r) => r.status !== "ok") ?? [];

  return (
    <Modal show={Boolean(request)} onHide={running ? undefined : onClose} centered>
      <Modal.Header closeButton={!running}>
        <Modal.Title as="h2" className="h5">
          {title}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}

        {!preview && !error && (
          <div className="d-flex align-items-center gap-2 text-muted">
            <Spinner animation="border" size="sm" />
            Checking what that would do…
          </div>
        )}

        {preview && (
          <>
            {preview.ok === 0 ? (
              <p className="mb-2">
                <strong>Nothing here can be {isDelete ? "deleted" : "copied"}.</strong>
              </p>
            ) : isDelete ? (
              <p>
                <strong>{plural(preview.ok, "recipe")}</strong> will be deleted.
                This cannot be undone.
              </p>
            ) : (
              <p>
                <strong>{plural(preview.ok, "recipe")}</strong> will be copied to{" "}
                {destination}. The originals stay exactly where they are, so you
                can change the copies without touching them.
              </p>
            )}

            {isDelete && (preview.plannedMeals ?? 0) > 0 && (
              <Alert variant="warning">
                {preview.plannedMeals === 1
                  ? "One planned meal uses"
                  : `${preview.plannedMeals} planned meals use`}{" "}
                {preview.ok === 1 ? "this recipe" : "these recipes"} and will be
                removed from the calendar too — <strong>past meals as well as
                future ones</strong>, so {preview.plannedMeals === 1 ? "it" : "they"} will
                also disappear from Past Preserves.
              </Alert>
            )}

            {refused.length > 0 && (
              <>
                <p className="mb-1 small fw-semibold">
                  {refused.length === 1
                    ? "One of your selection will be left alone:"
                    : `${refused.length} of your selection will be left alone:`}
                </p>
                <ul className="small mb-0 ps-3" style={{ maxHeight: "12rem", overflowY: "auto" }}>
                  {refused.map((r) => (
                    <li key={r.id}>
                      {r.name ?? <em>a recipe</em>}{" "}
                      <span className="text-muted">— {r.reason}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onClose} disabled={running}>
          Cancel
        </Button>
        <Button
          variant={isDelete ? "danger" : "primary"}
          onClick={confirm}
          disabled={running || !preview || preview.ok === 0}
        >
          {running ? (
            <Spinner animation="border" size="sm" />
          ) : isDelete ? (
            `Delete ${preview ? plural(preview.ok, "recipe") : ""}`.trim()
          ) : (
            `Copy ${preview ? plural(preview.ok, "recipe") : ""}`.trim()
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
