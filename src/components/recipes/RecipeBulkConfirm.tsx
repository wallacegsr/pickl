"use client";

import { useEffect, useState } from "react";
import { Alert, Spinner } from "react-bootstrap";
import Sheet from "@/components/ui/Sheet";
import type { BulkSummary } from "@/lib/recipeBulk";

/**
 * Which recipes: explicit ids, or `matching` — a Recipes page query meaning
 * every recipe it finds ("Select all 312 matching").
 */
type Selection = { ids: string[]; matching?: undefined } | { ids?: undefined; matching: string };

export type BulkRequest =
  | ({ action: "delete" } & Selection)
  | ({ action: "copy"; target: "private" | "shared" } & Selection)
  | ({ action: "tag"; tags: string[]; mode: "add" | "remove" } & Selection);

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
    // A "matching" selection is sent as the ids the preview found, not as the
    // query again: what runs is exactly the list the person just agreed to,
    // even if someone added a recipe that matches in the meantime.
    const payload =
      request.matching !== undefined && preview
        ? { ...request, matching: undefined, ids: preview.rows.map((r) => r.id) }
        : request;
    const res = await fetch("/api/recipes/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
  const isTag = request?.action === "tag";
  const tagList = request?.action === "tag" ? request.tags.join(", ") : "";
  const tagMode = request?.action === "tag" ? request.mode : null;
  const destination =
    request?.action === "copy"
      ? request.target === "private"
        ? "your Secret Stash"
        : "the House Jar"
      : "";

  // Until a "matching" preview arrives, the count is not known yet.
  const selectionSize = request?.ids?.length ?? preview?.rows.length;
  const countLabel = selectionSize === undefined ? "the matching recipes" : plural(selectionSize, "recipe");

  // The title names the action, the button carries the count, and the body
  // explains the consequence — each said once.
  const title = !request
    ? ""
    : isDelete
      ? "Delete recipes?"
      : isTag
        ? `${tagMode === "add" ? "Add" : "Remove"} ${request.action === "tag" && request.tags.length === 1 ? "a tag" : "tags"}?`
        : `Copy to ${destination}?`;

  const refused = preview?.rows.filter((r) => r.status !== "ok") ?? [];

  const verb = isDelete ? "Delete" : isTag ? (tagMode === "add" ? "Add" : "Remove") : "Copy";
  const footerActionLabel = !preview
    ? "Checking…"
    : isTag
      ? `${verb} on ${plural(preview.ok, "recipe")}`
      : `${verb} ${plural(preview.ok, "recipe")}`;

  return (
    <Sheet
      show={Boolean(request)}
      title={title}
      subtitle={preview ? previewSubtitle(preview) : "Checking what that would do…"}
      onClose={onClose}
      onAction={confirm}
      actionLabel={verb}
      footerActionLabel={footerActionLabel}
      actionVariant={isDelete ? "danger" : "primary"}
      actionDisabled={!preview || preview.ok === 0}
      busy={running}
    >
      <div className="p-3">
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
                <strong>
                  {isTag
                    ? "Nothing here would change."
                    : `Nothing here can be ${isDelete ? "deleted" : "copied"}.`}
                </strong>
              </p>
            ) : isTag ? (
              <p>
                <strong>{tagList}</strong> will be{" "}
                {tagMode === "add" ? "added to" : "removed from"}{" "}
                <strong>{plural(preview.ok, "recipe")}</strong>. Their other tags
                stay exactly as they are.
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

            {isTag && (preview.newTags?.length ?? 0) > 0 && (
              // Shown so a typo reads as what it is. "Comfrot" in a list of
              // existing tags is easy to miss; flagged as brand new, it is not.
              <Alert variant="info">
                {preview.newTags!.length === 1 ? "This is a new tag" : "These are new tags"}{" "}
                and will be created: <strong>{preview.newTags!.join(", ")}</strong>.
                If that&apos;s a typo, go back and fix it.
              </Alert>
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
      </div>
    </Sheet>
  );
}

/**
 * What the header says under the title. The count belongs on the button, so
 * this carries only the part nothing else says: what will be left alone.
 */
function previewSubtitle(preview: BulkSummary): string | undefined {
  const refused = preview.skipped + preview.failed;
  return refused > 0 ? `${refused} of your selection will be left alone` : undefined;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
