"use client";

import { useState } from "react";
import { Alert, Button, Form, Modal, Nav, Spinner } from "react-bootstrap";

export interface CreatedUserResult {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  verified: boolean;
  canAccessSharedCalendar: boolean;
  isGlobalAdmin: boolean;
  temporaryPassword?: string;
  message?: string;
}

type Mode = "manual" | "invite";

const PASSWORD_CHARS =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";

function generatePassword(length = 14): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += PASSWORD_CHARS[Math.floor(Math.random() * PASSWORD_CHARS.length)];
  }
  return out;
}

export default function AddUserModal({
  show,
  onHide,
  onCreated,
}: {
  show: boolean;
  onHide: () => void;
  onCreated: (result: CreatedUserResult) => void;
}) {
  const [mode, setMode] = useState<Mode>("manual");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setName("");
    setEmail("");
    setRole("member");
    setPassword("");
    setError(null);
  }

  function handleClose() {
    resetForm();
    onHide();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const endpoint =
      mode === "manual" ? "/api/admin/users/manual" : "/api/admin/users/invite";
    const body =
      mode === "manual" ? { name, email, role, password } : { name, email, role };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setError(data.error || "Could not create user.");
      return;
    }

    resetForm();
    onCreated(data as CreatedUserResult);
  }

  return (
    <Modal show={show} onHide={handleClose} centered>
      <Modal.Header closeButton>
        <Modal.Title>Add User</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Nav
          variant="tabs"
          activeKey={mode}
          className="mb-3"
          onSelect={(k) => {
            setMode((k as Mode) ?? "manual");
            setError(null);
          }}
        >
          <Nav.Item>
            <Nav.Link eventKey="manual">Manual</Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link eventKey="invite">Invite by Email</Nav.Link>
          </Nav.Item>
        </Nav>

        {error && <Alert variant="danger">{error}</Alert>}

        <Form onSubmit={handleSubmit}>
          <Form.Group className="mb-3" controlId="addUserName">
            <Form.Label>Name</Form.Label>
            <Form.Control
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Form.Group>
          <Form.Group className="mb-3" controlId="addUserEmail">
            <Form.Label>Email</Form.Label>
            <Form.Control
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Form.Group>
          <Form.Group className="mb-3" controlId="addUserRole">
            <Form.Label>Role</Form.Label>
            <Form.Select
              value={role}
              onChange={(e) => setRole(e.target.value as "member" | "admin")}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </Form.Select>
          </Form.Group>

          {mode === "manual" ? (
            <Form.Group className="mb-3" controlId="addUserPassword">
              <Form.Label>Temporary Password</Form.Label>
              <div className="d-flex gap-2">
                <Form.Control
                  type="text"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline-secondary"
                  onClick={() => setPassword(generatePassword())}
                >
                  Generate
                </Button>
              </div>
              <Form.Text className="text-muted">
                Shown once after creation — share it with the user directly.
                They can log in immediately with it.
              </Form.Text>
            </Form.Group>
          ) : (
            <Alert variant="info" className="small">
              An invite email (or console-logged link, if SMTP isn&apos;t
              configured) will be sent with a link for this person to set
              their own password.
            </Alert>
          )}

          <div className="d-grid">
            <Button type="submit" disabled={loading}>
              {loading ? (
                <Spinner animation="border" size="sm" />
              ) : mode === "manual" ? (
                "Create Account"
              ) : (
                "Send Invite"
              )}
            </Button>
          </div>
        </Form>
      </Modal.Body>
    </Modal>
  );
}
