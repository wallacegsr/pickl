"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Form, Modal, Spinner } from "react-bootstrap";
import type { RecipeWithTags } from "@/db/schema";
import { tagKey } from "@/lib/tagNames";
import type { BulkSummary } from "@/lib/recipeBulk";

/**
 * "Edit recipes…" for one tag: every recipe you can see, ticked where it
 * carries the tag. Tick to add, untick to remove, save once.
 *
 * The tag-first counterpart to the recipe list's "Tag…" button. Both send the
 * same bulk "tag" action, add and remove only, so the permission rule — a tag
 * change reaches only recipes you may edit — is enforced in one place.
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
  const [recipes, setRecipes] = useState<RecipeWithTags[] | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [original, setOriginal] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRecipes(null);
    setError(null);
    setQuery("");
    if (!tagName) return;
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/recipes");
      const list = res.ok ? ((await res.json()) as RecipeWithTags[]) : null;
      if (cancelled) return;
      if (!list) {
        setError("Could not load recipes.");
        return;
      }
      const key = tagKey(tagName);
      const carrying = new Set(list.filter((r) => r.tags.some((t) => tagKey(t) === key)).map((r) => r.id));
      setRecipes([...list].sort((a, b) => a.name.localeCompare(b.name)));
      setOriginal(carrying);
      setTicked(new Set(carrying));
    })();
    return () => {
      cancelled = true;
    };
  }, [tagName]);

  const canEdit = (r: RecipeWithTags) =>
    r.visibility === "shared" ? isAdmin : r.ownerUserId === currentUserId;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (recipes ?? []).filter((r) => !q || r.name.toLowerCase().includes(q));
  }, [recipes, query]);

  const toAdd = [...ticked].filter((id) => !original.has(id));
  const toRemove = [...original].filter((id) => !ticked.has(id));

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
        {!recipes && !error && (
          <div className="d-flex align-items-center gap-2 text-muted">
            <Spinner animation="border" size="sm" /> Loading recipes…
          </div>
        )}
        {recipes && (
          <>
            <Form.Control
              className="mb-2"
              placeholder="Filter recipes…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filter recipes"
            />
            {shown.map((r) => {
              const editable = canEdit(r);
              return (
                <Form.Check
                  key={r.id}
                  type="checkbox"
                  id={`tag-recipe-${r.id}`}
                  checked={ticked.has(r.id)}
                  disabled={!editable}
                  onChange={() =>
                    setTicked((prev) => {
                      const next = new Set(prev);
                      if (next.has(r.id)) next.delete(r.id);
                      else next.add(r.id);
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
            {shown.length === 0 && <p className="text-muted mb-0">No recipes match.</p>}
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
