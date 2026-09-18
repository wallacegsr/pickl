"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Form, Spinner } from "react-bootstrap";
import Sheet from "@/components/ui/Sheet";
import ListRow, { ListRows } from "@/components/ui/ListRow";
import Chip, { ChipRow } from "@/components/ui/Chip";
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
    <Sheet
      show={Boolean(tagName)}
      title={`Tagged “${tagName}”`}
      subtitle={
        toAdd.length || toRemove.length
          ? `Adding to ${toAdd.length}, removing from ${toRemove.length}`
          : data
            ? `${data.total.toLocaleString()} recipes`
            : "Loading…"
      }
      onClose={onClose}
      onAction={save}
      actionLabel="Save"
      actionDisabled={toAdd.length === 0 && toRemove.length === 0}
      busy={saving}
      footerNote="Tap a recipe to add or remove this tag."
      toolbar={
        <>
          <Form.Control
            type="search"
            className="mb-2"
            placeholder="Search recipes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search recipes by name"
          />
          <ChipRow label="Which recipes">
            <Chip
              label="House Jar"
              active={tab === "shared"}
              onClick={() => {
                setTab("shared");
                setPage(1);
              }}
            />
            <Chip
              label="My Secret Stash"
              active={tab === "mine"}
              onClick={() => {
                setTab("mine");
                setPage(1);
              }}
            />
            <Chip
              label="Has this tag"
              active={onlyTagged}
              onClick={() => {
                setOnlyTagged(!onlyTagged);
                setPage(1);
              }}
            />
          </ChipRow>
        </>
      }
    >
      {error && (
        <Alert variant="danger" className="m-3">
          {error}
        </Alert>
      )}
      {!data && !error && (
        <div className="d-flex align-items-center gap-2 text-muted p-3">
          <Spinner animation="border" size="sm" /> Loading recipes…
        </div>
      )}
      {data && (
        <>
          <ListRows label="Recipes">
            {data.rows.map((r) => {
              const editable = canEdit(r);
              const had = r.tags.some((t) => tagKey(t) === key);
              const checked = changes.get(r.id)?.now ?? had;
              return (
                <ListRow
                  key={r.id}
                  title={r.name}
                  meta={[
                    r.visibility === "private" ? "Private" : null,
                    editable ? null : "You can't change this one",
                    ...r.tags,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  selected={checked}
                  disabled={!editable}
                  onClick={() =>
                    setChanges((prev) => {
                      const next = new Map(prev);
                      const was = prev.get(r.id)?.was ?? had;
                      const now = !checked;
                      if (now === was) next.delete(r.id);
                      else next.set(r.id, { was, now });
                      return next;
                    })
                  }
                />
              );
            })}
          </ListRows>
          {data.rows.length === 0 && <p className="pickl-sheet-note py-4 mb-0">No recipes match.</p>}
          {pageCount > 1 && (
            <div className="d-flex justify-content-between align-items-center gap-2 p-3 small">
              <Button size="sm" variant="outline-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span className="text-body-secondary">
                Page {data.page} of {pageCount}
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
    </Sheet>
  );
}
