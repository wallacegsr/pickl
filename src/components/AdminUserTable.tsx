"use client";

import { useState } from "react";
import { Alert, Badge, Button, Form, Table } from "react-bootstrap";
import { useRouter } from "next/navigation";
import AddUserModal, { type CreatedUserResult } from "@/components/AddUserModal";

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  verified: boolean;
  canAccessSharedCalendar: boolean;
  isGlobalAdmin: boolean;
}

export default function AdminUserTable({
  initialUsers,
  currentUserId,
}: {
  initialUsers: AdminUserRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialUsers);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [successAlert, setSuccessAlert] = useState<{
    message: string;
    temporaryPassword?: string;
  } | null>(null);

  async function patchUser(id: string, patch: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) {
      setError(data.error || "Could not update user.");
      return;
    }
    setRows((prev) => prev.map((u) => (u.id === id ? { ...u, ...data } : u)));
    router.refresh();
  }

  function handleUserCreated(result: CreatedUserResult) {
    setRows((prev) => [
      ...prev,
      {
        id: result.id,
        name: result.name,
        email: result.email,
        role: result.role,
        active: result.active,
        verified: result.verified,
        canAccessSharedCalendar: result.canAccessSharedCalendar,
        isGlobalAdmin: result.isGlobalAdmin,
      },
    ]);
    setShowAddUser(false);
    setSuccessAlert(
      result.temporaryPassword
        ? {
            message: `Account created for ${result.email}.`,
            temporaryPassword: result.temporaryPassword,
          }
        : { message: result.message || `Invitation sent to ${result.email}.` }
    );
    router.refresh();
  }

  return (
    <div>
      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {successAlert && (
        <Alert
          variant="success"
          dismissible
          onClose={() => setSuccessAlert(null)}
        >
          {successAlert.message}
          {successAlert.temporaryPassword && (
            <div className="mt-1">
              Temporary password:{" "}
              <code>{successAlert.temporaryPassword}</code> — share this with
              the user. It won&apos;t be shown again.
            </div>
          )}
        </Alert>
      )}
      <div className="d-flex justify-content-end mb-3">
        <Button variant="primary" size="sm" onClick={() => setShowAddUser(true)}>
          + Add User
        </Button>
      </div>
      <div className="table-responsive">
        <Table bordered hover className="align-middle">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Verified</th>
              <th>Active</th>
              <th>Shared Calendar Access</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const isSelf = u.id === currentUserId;
              const busy = busyId === u.id;
              return (
                <tr key={u.id}>
                  <td>
                    {u.name}
                    {isSelf && (
                      <Badge bg="secondary" className="ms-2">
                        you
                      </Badge>
                    )}
                    {u.isGlobalAdmin && (
                      <Badge bg="warning" text="dark" className="ms-2">
                        Global Admin
                      </Badge>
                    )}
                  </td>
                  <td>{u.email}</td>
                  <td>
                    <Badge bg={u.role === "admin" ? "primary" : "light"} text={u.role === "admin" ? undefined : "dark"}>
                      {u.role}
                    </Badge>
                  </td>
                  <td>
                    <Form.Check
                      type="switch"
                      id={`verified-${u.id}`}
                      checked={u.verified}
                      disabled={busy}
                      onChange={(e) => patchUser(u.id, { verified: e.target.checked })}
                    />
                  </td>
                  <td>
                    <Form.Check
                      type="switch"
                      id={`active-${u.id}`}
                      checked={u.active}
                      disabled={busy || u.isGlobalAdmin}
                      onChange={(e) => patchUser(u.id, { active: e.target.checked })}
                    />
                    {u.isGlobalAdmin && (
                      <Form.Text className="text-muted">
                        The global admin can&apos;t be deactivated.
                      </Form.Text>
                    )}
                  </td>
                  <td>
                    <Form.Check
                      type="switch"
                      id={`shared-${u.id}`}
                      checked={u.canAccessSharedCalendar}
                      disabled={busy || u.role === "admin"}
                      onChange={(e) =>
                        patchUser(u.id, { canAccessSharedCalendar: e.target.checked })
                      }
                    />
                  </td>
                  <td>
                    {u.isGlobalAdmin ? (
                      <Form.Text className="text-muted">
                        Fixed at bootstrap — cannot be promoted/demoted.
                      </Form.Text>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline-secondary"
                        disabled={busy}
                        onClick={() =>
                          patchUser(u.id, { role: u.role === "admin" ? "member" : "admin" })
                        }
                      >
                        {u.role === "admin" ? "Demote to member" : "Promote to admin"}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>
      <AddUserModal
        show={showAddUser}
        onHide={() => setShowAddUser(false)}
        onCreated={handleUserCreated}
      />
    </div>
  );
}
