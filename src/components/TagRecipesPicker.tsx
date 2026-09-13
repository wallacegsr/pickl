"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Form, Modal, Spinner } from "react-bootstrap";
import { tagKey } from "@/lib/tagNames";
import type { BulkSummary } from "@/lib/recipeBulk";
import type { RecipePage, RecipeTab } from "@/lib/recipeQueryParams";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * "Recipes…" for one tag: search the jar, tick to add the tag, untick to
 * remove it, save once.
 *
 * The tag-first counterpart to the recipe list's "Tag…" button. Both send the
 * same bulk "tag" action, add and remove only, so the permission rule — a tag
 * change reaches only recipes you may edit — is enforced in one place.
 *
 * It searches and pages through the server (GET /api/recipes/search) rather
 * than loading the whole jar. Ticks are remembered as changes, so they survive
 * searching for something else and paging.
 *
 * Recipes you cannot edit are listed but disabled, rather than hidden. Hiding
 * them would make "Weeknight is on 3 recipes" and a picker showing 1 ticked
 * disagree with no explanation.
 */
export default function TagRecipesPicker({
  tagName,
  isAdmin,
  currentUserId,
  onClose,
  onSaved,
}: {
  /** The tag being edited, or null when closed. */
  tagName: string | null;
  isAdmin: boolean;
  currentUserId: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [tab, setTab] = useState<RecipeTab>("shared");
  const [query, setQuery] = useState("");
  const [sent, setSent] = useState("");
  const [onlyTagged, setOnlyTagged] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RecipePage | null>(null);
  /** Recipe id → { had the tag, has it now }. Only recipes that were toggled. */
  const [changes, setChanges] = useState<Map<string, { was: boolean; now: boolean }>>(new Map());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh for each tag.
  useEffect(() => {
    setTab("shared");
    setQuery("");
    setSent("");
    setOnlyTagged(false);
    setPage(1);
    setChanges(new Map());
    setError(null);
  }, [tagName]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSent(query);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!tagName) return;
    let cancelled = false;
    const params = new URLSearchParams({ sort: "name", page: String(page), in: "name" });
    if (tab === "mine") params.set("tab", "mine");
    if (sent.trim()) params.set("q", sent);
    if (onlyTagged) params.set("tag", tagName);
    setData(null);
    (async () => {
      const res = await fetch(`/api/recipes/search?${params}`);
      const body = res.ok ? ((await res.json()) as RecipePage) : null;
      if (cancelled) return;
      if (!body) setError("Could not load recipes.");
      else setData(body);
    })();
    return () => {
      cancelled = true;
    };
  }, [tagName, tab, sent, onlyTagged, page]);

  const key = tagName ? tagKey(tagName) : "";
  const canEdit = (r: RecipePage["rows"][number]) =>
    r.visibility === "shared" ? isAdmin : r.ownerUserId === currentUserId;

  const toAdd = [...changes].filter(([, c]) => !c.was && c.now).map(([id]) => id);
  const toRemove = [...changes].filter(([, c]) => c.was && !c.now).map(([id]) => id);
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  async function save() {
    if (!tagName) return;
    setSaving(true);
    setError(null);
    const send = async (mode: "add" | "remove", ids: string[]) => {
      if (ids.length === 0) return null;
      const res = await fetch("/api/recipes/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tag", ids, tags: [tagName], mode }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "That did not save.");
      return body as BulkSummary;
    };
    try {
      const added = await send("add", toAdd);
      const removed = await send("remove", toRemove);
      const parts: string[] = [];
      if (added?.ok) parts.push(`added to ${added.ok} recipe${added.ok === 1 ? "" : "s"}`);
      if (removed?.ok) parts.push(`removed from ${removed.ok} recipe${removed.ok === 1 ? "" : "s"}`);
      const refused = (added?.skipped ?? 0) + (added?.failed ?? 0) + (removed?.skipped ?? 0) + (removed?.failed ?? 0);
      onSaved(
        `"${tagName}" ${parts.join(" and ") || "unchanged"}.` +
          (refused ? ` ${refused} could not be changed.` : "")
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal show={Boolean(tagName)} onHide={saving ? undefined : onClose} centered scrollable>
      <Modal.Header closeButton={!saving}>
        <Modal.Title as="h2" className="h5">
          Recipes tagged “{tagName}”
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}
        <div className="d-flex flex-wrap gap-2 mb-2">
          <Form.Select
            size="sm"
            className="w-auto"
            aria-label="Which recipes"
            value={tab}
            onChange={(e) => {
              setTab(e.target.value === "mine" ? "mine" : "shared");
              setPage(1);
            }}
          >
            <option value="shared">The House Jar</option>
            <option value="mine">My Secret Stash</option>
          </Form.Select>
          <Form.Check
            type="switch"
            id="tag-picker-only-tagged"
            className="mb-0 align-self-center"
            label="Only ones with this tag"
            checked={onlyTagged}
            onChange={(e) => {
              setOnlyTagged(e.target.checked);
              setPage(1);
            }}
          />
        </div>
        <Form.Control
          className="mb-2"
          placeholder="Find a recipe by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Find a recipe by name"
        />
        {!data && !error && (
          <div className="d-flex align-items-center gap-2 text-muted">
            <Spinner animation="border" size="sm" /> Loading recipes…
          </div>
        )}
        {data && (
          <>
            {data.rows.map((r) => {
              const editable = canEdit(r);
              const had = r.tags.some((t) => tagKey(t) === key);
              const checked = changes.get(r.id)?.now ?? had;
              return (
                <Form.Check
                  key={r.id}
                  type="checkbox"
                  id={`tag-recipe-${r.id}`}
                  checked={checked}
                  disabled={!editable}
                  onChange={() =>
                    setChanges((prev) => {
                      const next = new Map(prev);
                      const was = prev.get(r.id)?.was ?? had;
                      const now = !checked;
                      if (now === was) next.delete(r.id);
                      else next.set(r.id, { was, now });
                      return next;
                    })
                  }
                  label={
                    <>
                      {r.name}
                      {r.visibility === "private" && <span className="text-muted small"> · private</span>}
                      {!editable && <span className="text-muted small"> · you can&apos;t change this one</span>}
                    </>
                  }
                />
              );
            })}
            {data.rows.length === 0 && <p className="text-muted mb-0">No recipes match.</p>}
            {pageCount > 1 && (
              <div className="d-flex justify-content-between align-items-center mt-2 small">
                <Button size="sm" variant="outline-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <span className="text-muted">
                  Page {data.page} of {pageCount} · {data.total.toLocaleString()} recipes
                </span>
                <Button
                  size="sm"
                  variant="outline-secondary"
                  disabled={page >= pageCount}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </Modal.Body>
      <Modal.Footer className="justify-content-between">
        <span className="small text-muted">
          {toAdd.length || toRemove.length
            ? `Adding to ${toAdd.length}, removing from ${toRemove.length}`
            : "No changes yet"}
        </span>
        <div className="d-flex gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || (toAdd.length === 0 && toRemove.length === 0)}>
            {saving ? <Spinner animation="border" size="sm" /> : "Save"}
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
}
