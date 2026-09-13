"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Alert,
  Badge,
  Button,
  Card,
  Form,
  InputGroup,
  Modal,
  Spinner,
  Table,
} from "react-bootstrap";
import { tagKey, MAX_TAG_LENGTH } from "@/lib/tagNames";
import type { TagBulkSummary, TagSummary } from "@/lib/tags";
import TagRecipesPicker from "@/components/TagRecipesPicker";

/**
 * The Tags page.
 *
 * Everything here is a vocabulary edit, never a recipe edit — deleting a tag
 * takes it off recipes and nothing else — and the copy says so at every
 * point where somebody could reasonably fear otherwise.
 *
 * The other thing this screen owes the user is honesty about reach. A tag
 * does not belong to anybody: the same word can sit on a shared recipe and
 * on your own private one. A member may edit only their own private
 * recipes, so their rename moves the tag on those and leaves it on the
 * shared ones — a genuinely partial outcome, spelled out BEFORE the button
 * is pressed rather than reported afterwards. `usage.locked` is the count
 * behind that warning; the server recomputes it and enforces the same rule
 * regardless of what this component displayed.
 */
export default function TagManager({
  initialTags,
  isAdmin,
  currentUserId,
}: {
  initialTags: TagSummary[];
  isAdmin: boolean;
  /** Needed by the recipe picker to show which recipes this person can change. */
  currentUserId: string;
}) {
  const router = useRouter();
  const [tags, setTags] = useState(initialTags);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [renameTarget, setRenameTarget] = useState<TagSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameMergeAck, setRenameMergeAck] = useState(false);
  const [busy, setBusy] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<TagSummary | null>(null);
  const [recipesFor, setRecipesFor] = useState<string | null>(null);

  // --- bulk selection ------------------------------------------------------
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkPreview, setBulkPreview] = useState<TagBulkSummary | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);

  const [filter, setFilter] = useState("");
  const [unusedOnly, setUnusedOnly] = useState(false);
  /** The tags on screen: the whole list, narrowed by the filter box. */
  const shown = useMemo(() => {
    const needle = tagKey(filter);
    return tags.filter(
      (t) => (!needle || tagKey(t.name).includes(needle)) && (!unusedOnly || t.usage.total === 0)
    );
  }, [tags, filter, unusedOnly]);

  // A selection only holds tags on screen: after a delete, a refresh, or when
  // the filter hides some. Same rule as the recipe list — Delete must never
  // reach a tag the person cannot see.
  useEffect(() => {
    setSelected((prev) => {
      const present = new Set(shown.map((t) => t.id));
      const kept = [...prev].filter((id) => present.has(id));
      return kept.length === prev.size ? prev : new Set(kept);
    });
  }, [shown]);

  const allSelected = shown.length > 0 && shown.every((t) => selected.has(t.id));
  const someSelected = selected.size > 0 && !allSelected;

  function toggleTag(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Opens the bulk-delete confirmation and asks the server what it would do
   * before showing anything, so the numbers in the dialog are the ones the
   * delete will actually produce — including tags that survive because they
   * are still on recipes out of this person's reach.
   */
  async function openBulkDelete() {
    setError(null);
    setNotice(null);
    setBulkPreview(null);
    setBulkOpen(true);
    const res = await fetch("/api/tags/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selected], preview: true }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setBulkOpen(false);
      setError(data?.error ?? "Could not work out what that would do.");
      return;
    }
    setBulkPreview(data as TagBulkSummary);
  }

  async function confirmBulkDelete() {
    setBulkRunning(true);
    const res = await fetch("/api/tags/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selected] }),
    });
    const data = (await res.json().catch(() => null)) as TagBulkSummary | null;
    setBulkRunning(false);
    setBulkOpen(false);
    if (!res.ok || !data) {
      setError((data as { error?: string } | null)?.error ?? "Could not delete those tags.");
      return;
    }

    // Re-read the list rather than dropping rows locally: a tag still carried
    // by recipes out of reach survives the delete with a smaller count, and
    // only the server knows the new one.
    const fresh = await fetch("/api/tags").then((r) => (r.ok ? r.json() : null));
    applyResult(
      { tags: fresh ?? undefined },
      `Deleted ${data.ok} tag${data.ok === 1 ? "" : "s"}, taking ${data.removedFrom === 1 ? "one tagging" : `${data.removedFrom} taggings`} off recipes. No recipes were deleted.` +
        (data.skipped + data.failed > 0 ? ` ${data.skipped + data.failed} left alone.` : "")
    );
    setSelected(new Set());
  }

  /** The tag the rename would collide with, if any — drives the merge copy. */
  const mergeInto = useMemo(() => {
    if (!renameTarget) return null;
    const key = tagKey(renameValue);
    if (!key || key === tagKey(renameTarget.name)) return null;
    return tags.find((t) => tagKey(t.name) === key) ?? null;
  }, [renameTarget, renameValue, tags]);

  function applyResult(
    data: { tags?: TagSummary[] },
    message: string
  ) {
    if (data.tags) setTags(data.tags);
    setNotice(message);
    setError(null);
    // Recipe cards elsewhere show these tags, so refresh the server tree too.
    router.refresh();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    setCreating(false);
    if (!res.ok) {
      setNotice(null);
      setError(data.error || "Could not create that tag.");
      return;
    }
    applyResult(data, `Created the tag "${newName.trim()}".`);
    setNewName("");
  }

  function openRename(tag: TagSummary) {
    setRenameTarget(tag);
    setRenameValue(tag.name);
    setRenameMergeAck(false);
    setError(null);
    setNotice(null);
  }

  async function submitRename() {
    if (!renameTarget) return;
    setBusy(true);
    const res = await fetch(`/api/tags/${renameTarget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: renameValue.trim(),
        confirmMerge: Boolean(mergeInto) && renameMergeAck,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setNotice(null);
      setError(data.error || "Could not rename that tag.");
      return;
    }
    setRenameTarget(null);
    applyResult(
      data,
      `${data.merged ? "Merged" : "Renamed"} to "${data.tagName}" on ${
        data.movedRecipes
      } recipe${data.movedRecipes === 1 ? "" : "s"}.` +
        (data.lockedRecipes > 0
          ? ` ${data.lockedRecipes} recipe${
              data.lockedRecipes === 1 ? "" : "s"
            } you can't edit kept the old tag.`
          : "")
    );
  }

  async function submitDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    const res = await fetch(`/api/tags/${deleteTarget.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setNotice(null);
      setError(data.error || "Could not delete that tag.");
      return;
    }
    setDeleteTarget(null);
    applyResult(
      data,
      `Removed "${data.tagName}" from ${data.movedRecipes} recipe${
        data.movedRecipes === 1 ? "" : "s"
      }. No recipes were deleted.` +
        (data.lockedRecipes > 0
          ? ` ${data.lockedRecipes} recipe${
              data.lockedRecipes === 1 ? "" : "s"
            } you can't edit still carry it.`
          : "")
    );
  }

  /** The partial-reach warning, or null when the edit applies to everything. */
  function partialWarning(tag: TagSummary, verb: string) {
    if (tag.usage.locked === 0) return null;
    if (tag.usage.editable === 0) {
      return (
        <>
          Every recipe using <strong>{tag.name}</strong> is one you aren&apos;t
          allowed to edit, so there is nothing here for you to {verb}.
        </>
      );
    }
    const mine = tag.usage.editable;
    const theirs = tag.usage.locked;
    return (
      <>
        This tag is on <strong>{tag.usage.total} recipes</strong>, but only{" "}
        <strong>
          {mine} of them {mine === 1 ? "is" : "are"} yours to edit
        </strong>
        . {verb === "rename" ? "Renaming" : "Deleting"} it here changes{" "}
        {mine === 1 ? "that one recipe" : `those ${mine} recipes`} and leaves the
        other {theirs === 1 ? "one" : theirs} exactly as{" "}
        {theirs === 1 ? "it is" : "they are"} — {theirs === 1 ? "it keeps" : "they keep"}{" "}
        <strong>{tag.name}</strong>.{" "}
        {isAdmin
          ? "Those are private recipes belonging to other people, and nobody but their owner can change a tag on them."
          : "Those are recipes you can't edit — shared household recipes, or somebody else's private ones."}
      </>
    );
  }

  return (
    <div>
      {error && (
        <Alert variant="danger" onClose={() => setError(null)} dismissible>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert variant="success" onClose={() => setNotice(null)} dismissible>
          {notice}
        </Alert>
      )}

      <Card className="mb-4">
        <Card.Body>
          <Form onSubmit={handleCreate}>
            <Form.Label htmlFor="new-tag-name" className="fw-semibold">
              Add a tag
            </Form.Label>
            {/* Stacks on narrow screens rather than squeezing the field. */}
            <InputGroup className="flex-nowrap">
              <Form.Control
                id="new-tag-name"
                value={newName}
                maxLength={MAX_TAG_LENGTH}
                placeholder="e.g. weeknight"
                onChange={(e) => setNewName(e.target.value)}
              />
              <Button type="submit" disabled={creating || !newName.trim()}>
                {creating ? <Spinner animation="border" size="sm" /> : "Add"}
              </Button>
            </InputGroup>
            <Form.Text muted>
              A tag can exist before anything uses it — handy for setting up a
              vocabulary you then pick from while adding recipes. Capitalisation
              is remembered but ignored when matching, so &quot;Quick&quot; and
              &quot;quick&quot; are the same tag.
            </Form.Text>
          </Form>
        </Card.Body>
      </Card>

      {tags.length === 0 ? (
        <p className="text-muted">
          No tags yet. Add one above, or type tags into any recipe and they will
          show up here.
        </p>
      ) : (
        <>
        <div className="d-flex flex-wrap align-items-center gap-3 mb-3">
          <Form.Control
            type="search"
            placeholder="Filter tags…"
            aria-label="Filter tags"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ maxWidth: "20rem" }}
          />
          <Form.Check
            type="switch"
            id="tags-unused-only"
            className="mb-0"
            label="Unused only"
            title="Tags no recipe carries — the usual candidates for a tidy-up"
            checked={unusedOnly}
            onChange={(e) => setUnusedOnly(e.target.checked)}
          />
          <span className="small text-body-secondary" aria-live="polite">
            {shown.length === tags.length
              ? `${tags.length} tag${tags.length === 1 ? "" : "s"}`
              : `${shown.length} of ${tags.length} tags`}
          </span>
        </div>
        {selected.size > 0 && (
          <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
            <span className="small fw-semibold">
              {selected.size} of {shown.length} selected
            </span>
            <Button size="sm" variant="outline-danger" onClick={openBulkDelete}>
              Delete {selected.size === 1 ? "tag" : `${selected.size} tags`}
            </Button>
            <Button size="sm" variant="link" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        )}
        <div className="table-responsive">
          <Table hover className="align-middle">
            <thead>
              <tr>
                <th scope="col" style={{ width: "2.5rem" }}>
                  <Form.Check
                    type="checkbox"
                    id="select-all-tags"
                    className="mb-0"
                    checked={allSelected}
                    ref={(el: HTMLInputElement | null) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={() =>
                      setSelected(allSelected ? new Set() : new Set(shown.map((t) => t.id)))
                    }
                    aria-label={allSelected ? "Deselect all tags" : "Select all tags"}
                  />
                </th>
                <th scope="col">Tag</th>
                <th scope="col">Recipes</th>
                <th scope="col" className="text-end">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((tag) => (
                <tr key={tag.id} className={selected.has(tag.id) ? "table-active" : undefined}>
                  <td>
                    <Form.Check
                      type="checkbox"
                      id={`select-tag-${tag.id}`}
                      className="mb-0"
                      checked={selected.has(tag.id)}
                      onChange={() => toggleTag(tag.id)}
                      aria-label={`Select ${tag.name}`}
                    />
                  </td>
                  <td>
                    <Badge bg="secondary" className="recipe-tag-badge">
                      {tag.name}
                    </Badge>
                  </td>
                  <td>
                    {tag.usage.total === 0 ? (
                      // Nothing to open, so nothing to link to.
                      <span className="text-body-secondary">Not used yet</span>
                    ) : (
                      <>
                        <Link
                          href={`/recipes?tag=${encodeURIComponent(tag.name)}`}
                          title={`Show the ${tag.usage.total} recipe${
                            tag.usage.total === 1 ? "" : "s"
                          } tagged "${tag.name}"`}
                        >
                          {tag.usage.total}
                        </Link>
                        {tag.usage.locked > 0 && (
                          <span className="text-body-secondary small ms-2">
                            ({tag.usage.editable} you can edit)
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="text-end">
                    <div className="d-inline-flex flex-wrap gap-2 justify-content-end">
                      <Button
                        size="sm"
                        variant="outline-secondary"
                        onClick={() => {
                          setError(null);
                          setNotice(null);
                          setRecipesFor(tag.name);
                        }}
                        title="Choose which recipes carry this tag"
                      >
                        Recipes…
                      </Button>
                      <Button
                        size="sm"
                        variant="outline-primary"
                        onClick={() => openRename(tag)}
                      >
                        Rename
                      </Button>
                      <Button
                        size="sm"
                        variant="outline-danger"
                        onClick={() => {
                          setDeleteTarget(tag);
                          setError(null);
                          setNotice(null);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        {shown.length === 0 && (
          <p className="text-muted">
            No tags match.{" "}
            <Button
              variant="link"
              className="p-0 align-baseline"
              onClick={() => {
                setFilter("");
                setUnusedOnly(false);
              }}
            >
              Show all tags
            </Button>
          </p>
        )}
        </>
      )}

      <Modal show={Boolean(renameTarget)} onHide={() => setRenameTarget(null)}>
        <Modal.Header closeButton>
          <Modal.Title>Rename tag</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group controlId="rename-tag-name">
            <Form.Label>New name</Form.Label>
            <Form.Control
              value={renameValue}
              maxLength={MAX_TAG_LENGTH}
              onChange={(e) => {
                setRenameValue(e.target.value);
                setRenameMergeAck(false);
              }}
            />
          </Form.Group>

          {renameTarget && partialWarning(renameTarget, "rename") && (
            <Alert variant="warning" className="mt-3 mb-0">
              {partialWarning(renameTarget, "rename")}
            </Alert>
          )}

          {mergeInto && (
            <Alert variant="warning" className="mt-3 mb-0">
              <div className="mb-2">
                <strong>{mergeInto.name}</strong> already exists, so this is a{" "}
                <strong>merge, not a rename</strong>. The recipes you can edit
                will be moved onto <strong>{mergeInto.name}</strong>, and{" "}
                <strong>{renameTarget?.name}</strong> disappears once nothing is
                left on it. Merging cannot be undone in one click — you would
                have to re-tag the recipes by hand.
              </div>
              <Form.Check
                type="checkbox"
                id="confirm-merge"
                checked={renameMergeAck}
                onChange={(e) => setRenameMergeAck(e.target.checked)}
                label={`Yes, merge into "${mergeInto.name}"`}
              />
            </Alert>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setRenameTarget(null)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submitRename}
            disabled={
              busy ||
              !renameValue.trim() ||
              (Boolean(mergeInto) && !renameMergeAck) ||
              // A tag used only by recipes out of reach: nothing to change.
              // An unused tag (total 0) is still freely renameable.
              (renameTarget !== null &&
                renameTarget.usage.total > 0 &&
                renameTarget.usage.editable === 0)
            }
          >
            {busy ? (
              <Spinner animation="border" size="sm" />
            ) : mergeInto ? (
              "Merge"
            ) : (
              "Rename"
            )}
          </Button>
        </Modal.Footer>
      </Modal>

      <TagRecipesPicker
        tagName={recipesFor}
        isAdmin={isAdmin}
        currentUserId={currentUserId}
        onClose={() => setRecipesFor(null)}
        onSaved={async (message) => {
          setRecipesFor(null);
          // Counts changed, so re-read rather than guess the new numbers.
          const fresh = await fetch("/api/tags").then((r) => (r.ok ? r.json() : null));
          applyResult({ tags: fresh ?? undefined }, message);
        }}
      />

      <Modal
        show={bulkOpen}
        onHide={bulkRunning ? undefined : () => setBulkOpen(false)}
        centered
      >
        <Modal.Header closeButton={!bulkRunning}>
          <Modal.Title>
            Delete {selected.size === 1 ? "this tag" : `${selected.size} tags`}?
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {!bulkPreview ? (
            <div className="d-flex align-items-center gap-2 text-muted">
              <Spinner animation="border" size="sm" /> Checking what that would do…
            </div>
          ) : (
            <>
              <p>
                {bulkPreview.ok === 0 ? (
                  <strong>None of these can be deleted.</strong>
                ) : (
                  <>
                    <strong>
                      {bulkPreview.ok} tag{bulkPreview.ok === 1 ? "" : "s"}
                    </strong>{" "}
                    will be taken off{" "}
                    {bulkPreview.removedFrom === 1
                      ? "one recipe"
                      : `${bulkPreview.removedFrom} recipe taggings`}
                    . <strong>No recipe is deleted</strong> — they stay exactly
                    where they are, just without these tags.
                  </>
                )}
              </p>

              {/*
                Two different outcomes for a tag that survives, told apart
                because they look opposite from here. One stays on this
                person's list with a smaller count; the other remains only on
                other people's private recipes, so it leaves their list
                entirely — and a message saying "it will still exist" would read
                as a broken promise the moment the row disappears.
              */}
              {(() => {
                const survivors = bulkPreview.rows.filter(
                  (r) => r.status === "ok" && (r.keptOn ?? 0) > 0
                );
                const stay = survivors.filter((r) => r.staysVisible);
                const hide = survivors.filter((r) => !r.staysVisible);
                if (survivors.length === 0) return null;
                return (
                  <Alert variant="warning">
                    {stay.length > 0 && (
                      <p className={hide.length > 0 ? "mb-2" : "mb-0"}>
                        <strong>{stay.map((r) => r.name).join(", ")}</strong>{" "}
                        {stay.length === 1 ? "is" : "are"} also on recipes you
                        can&apos;t edit, which keep {stay.length === 1 ? "it" : "them"}.{" "}
                        {stay.length === 1 ? "It stays" : "They stay"} on your
                        list, on fewer recipes.
                      </p>
                    )}
                    {hide.length > 0 && (
                      <p className="mb-0">
                        <strong>{hide.map((r) => r.name).join(", ")}</strong>{" "}
                        {hide.length === 1 ? "is" : "are"} also on other
                        people&apos;s private recipes. Those keep{" "}
                        {hide.length === 1 ? "it" : "them"}, so{" "}
                        {hide.length === 1 ? "it isn't" : "they aren't"} really
                        deleted — but {hide.length === 1 ? "it" : "they"} will
                        disappear from your list, since you can&apos;t see those
                        recipes.
                      </p>
                    )}
                  </Alert>
                );
              })()}

              {bulkPreview.rows.some((r) => r.status !== "ok") && (
                <>
                  <p className="mb-1 small fw-semibold">Left alone:</p>
                  <ul className="small mb-0 ps-3">
                    {bulkPreview.rows
                      .filter((r) => r.status !== "ok")
                      .map((r) => (
                        <li key={r.id}>
                          {r.name ?? <em>a tag</em>}{" "}
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
          <Button variant="secondary" onClick={() => setBulkOpen(false)} disabled={bulkRunning}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={confirmBulkDelete}
            disabled={bulkRunning || !bulkPreview || bulkPreview.ok === 0}
          >
            {bulkRunning ? (
              <Spinner animation="border" size="sm" />
            ) : (
              `Delete ${bulkPreview?.ok === 1 ? "tag" : `${bulkPreview?.ok ?? ""} tags`}`
            )}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={Boolean(deleteTarget)} onHide={() => setDeleteTarget(null)}>
        <Modal.Header closeButton>
          <Modal.Title>Delete tag?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>
            This removes <strong>{deleteTarget?.name}</strong> from the recipes
            that carry it. <strong>No recipe is deleted</strong> — they all stay
            exactly where they are, just without this tag.
          </p>
          {deleteTarget && partialWarning(deleteTarget, "delete") && (
            <Alert variant="warning" className="mb-0">
              {partialWarning(deleteTarget, "delete")}
            </Alert>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={submitDelete}
            disabled={
              busy ||
              (deleteTarget !== null &&
                deleteTarget.usage.total > 0 &&
                deleteTarget.usage.editable === 0)
            }
          >
            {busy ? <Spinner animation="border" size="sm" /> : "Delete tag"}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
