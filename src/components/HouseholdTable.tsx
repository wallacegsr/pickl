"use client";

import { useState } from "react";
import { Alert, Badge, Button, Form, Modal, Table } from "react-bootstrap";

export interface HouseholdRow {
  id: string;
  name: string;
  suspended: boolean;
  createdAt: string;
  memberCount: number;
  recipeCount: number;
  plannedMealCount: number;
  holdsGlobalAdmin: boolean;
}

/**
 * The platform operator's households table.
 *
 * Shows what a household IS — its name, how many people are in it, how much
 * they have made, when it started — and never what is in it. There is no row
 * expansion, no "view as", and no link into a household's recipes or plan,
 * because no such endpoint exists to link to.
 */
export default function HouseholdTable({
  initialHouseholds,
}: {
  initialHouseholds: HouseholdRow[];
}) {
  const [rows, setRows] = useState(initialHouseholds);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const [renaming, setRenaming] = useState<HouseholdRow | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const [deleting, setDeleting] = useState<HouseholdRow | null>(null);
  const [confirmName, setConfirmName] = useState("");

  async function refresh() {
    const res = await fetch("/api/admin/households");
    if (res.ok) setRows(await res.json());
  }

  async function send(url: string, init: RequestInit): Promise<boolean> {
    setError(null);
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Something went wrong.");
      return false;
    }
    await refresh();
    return true;
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    const ok = await send("/api/admin/households", {
      method: "POST",
      body: JSON.stringify({ name: newName }),
    });
    setCreating(false);
    if (ok) setNewName("");
  }

  async function toggleSuspended(row: HouseholdRow) {
    setBusyId(row.id);
    await send(`/api/admin/households/${row.id}`, {
      method: "PATCH",
      body: JSON.stringify({ suspended: !row.suspended }),
    });
    setBusyId(null);
  }

  async function submitRename(e: React.FormEvent) {
    e.preventDefault();
    if (!renaming) return;
    setBusyId(renaming.id);
    const ok = await send(`/api/admin/households/${renaming.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: renameValue }),
    });
    setBusyId(null);
    if (ok) setRenaming(null);
  }

  async function submitDelete(e: React.FormEvent) {
    e.preventDefault();
    if (!deleting) return;
    setBusyId(deleting.id);
    const ok = await send(`/api/admin/households/${deleting.id}`, {
      method: "DELETE",
      body: JSON.stringify({ confirmName }),
    });
    setBusyId(null);
    if (ok) {
      setDeleting(null);
      setConfirmName("");
    }
  }

  return (
    <div>
      <p className="text-muted">
        Households on this deployment. You can create, rename, suspend and
        delete them — you cannot see what is inside one. That is the point.
      </p>

      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Form className="d-flex gap-2 mb-4" onSubmit={create}>
        <Form.Control
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New household name"
          maxLength={80}
          aria-label="New household name"
        />
        <Button type="submit" disabled={creating || !newName.trim()}>
          Add
        </Button>
      </Form>

      <div className="table-responsive">
        <Table hover className="align-middle">
          <thead>
            <tr>
              <th>Household</th>
              <th className="text-end">Members</th>
              <th className="text-end">Recipes</th>
              <th className="text-end">Planned meals</th>
              <th>Started</th>
              <th className="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  {row.name}{" "}
                  {row.suspended && (
                    <Badge bg="warning" text="dark">
                      Suspended
                    </Badge>
                  )}{" "}
                  {row.holdsGlobalAdmin && (
                    <Badge bg="secondary" title="Contains the account that administers this deployment.">
                      Operator&rsquo;s household
                    </Badge>
                  )}
                </td>
                <td className="text-end">{row.memberCount}</td>
                <td className="text-end">{row.recipeCount}</td>
                <td className="text-end">{row.plannedMealCount}</td>
                <td>{new Date(row.createdAt).toLocaleDateString()}</td>
                <td className="text-end">
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    className="me-2"
                    disabled={busyId === row.id}
                    onClick={() => {
                      setRenaming(row);
                      setRenameValue(row.name);
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    className="me-2"
                    disabled={busyId === row.id || row.holdsGlobalAdmin}
                    title={
                      row.holdsGlobalAdmin
                        ? "The operator's own household cannot be suspended."
                        : undefined
                    }
                    onClick={() => toggleSuspended(row)}
                  >
                    {row.suspended ? "Resume" : "Suspend"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline-danger"
                    disabled={busyId === row.id || row.holdsGlobalAdmin}
                    title={
                      row.holdsGlobalAdmin
                        ? "This would delete the account that administers this deployment."
                        : undefined
                    }
                    onClick={() => {
                      setDeleting(row);
                      setConfirmName("");
                    }}
                  >
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="text-muted text-center py-4">
                  No households yet.
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      </div>

      <Modal show={Boolean(renaming)} onHide={() => setRenaming(null)} centered>
        <Form onSubmit={submitRename}>
          <Modal.Header closeButton>
            <Modal.Title>Rename household</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Form.Label htmlFor="household-rename">Name</Form.Label>
            <Form.Control
              id="household-rename"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              maxLength={80}
              autoFocus
            />
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!renameValue.trim()}>
              Save
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal
        show={Boolean(deleting)}
        onHide={() => setDeleting(null)}
        centered
      >
        <Form onSubmit={submitDelete}>
          <Modal.Header closeButton>
            <Modal.Title>Delete household</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>
              This deletes <strong>{deleting?.name}</strong> and everything in
              it: {deleting?.memberCount} account
              {deleting?.memberCount === 1 ? "" : "s"},{" "}
              {deleting?.recipeCount} recipe
              {deleting?.recipeCount === 1 ? "" : "s"}, and{" "}
              {deleting?.plannedMealCount} planned meal
              {deleting?.plannedMealCount === 1 ? "" : "s"}, along with their
              shopping lists and history.
            </p>
            <p className="text-danger">
              There is no undo, and no export. Suspending it instead keeps
              everything and can be reversed.
            </p>
            <Form.Label htmlFor="household-confirm">
              Type <strong>{deleting?.name}</strong> to confirm
            </Form.Label>
            <Form.Control
              id="household-confirm"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              autoFocus
              autoComplete="off"
            />
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              disabled={confirmName.trim() !== deleting?.name}
            >
              Delete household
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </div>
  );
}
