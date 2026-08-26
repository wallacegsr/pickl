"use client";

import { useMemo, useState } from "react";
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
import type { TagSummary } from "@/lib/tags";

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
}: {
  initialTags: TagSummary[];
  isAdmin: boolean;
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
        <div className="table-responsive">
          <Table hover className="align-middle">
            <thead>
              <tr>
                <th scope="col">Tag</th>
                <th scope="col">Recipes</th>
                <th scope="col" className="text-end">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {tags.map((tag) => (
                <tr key={tag.id}>
                  <td>
                    <Badge bg="secondary" className="recipe-tag-badge">
                      {tag.name}
                    </Badge>
                  </td>
                  <td>
                    {tag.usage.total === 0 ? (
                      <span className="text-body-secondary">Not used yet</span>
                    ) : (
                      <>
                        {tag.usage.total}
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
