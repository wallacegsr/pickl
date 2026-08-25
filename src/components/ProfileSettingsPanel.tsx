"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { Alert, Button, Card, Form, Spinner } from "react-bootstrap";

export interface ProfileSettingsInitial {
  name: string;
  email: string;
  pendingEmail: string | null;
}

/** Human-readable messages for the ?error= codes /api/auth/confirm-email-change redirects with. */
const CONFIRM_ERRORS: Record<string, string> = {
  missing_token: "That confirmation link was missing its token.",
  invalid_token:
    "That confirmation link is not valid. It may have already been used, or the change was cancelled.",
  expired_token:
    "That confirmation link has expired. Request the email change again to get a fresh link.",
  email_taken:
    "That address was registered to another account before you confirmed. Try a different address.",
};

export default function ProfileSettingsPanel({
  initial,
  confirmError,
}: {
  initial: ProfileSettingsInitial;
  confirmError?: string;
}) {
  const { update: updateSession } = useSession();

  const [name, setName] = useState(initial.name);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSuccess, setNameSuccess] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [pendingEmail, setPendingEmail] = useState(initial.pendingEmail);
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(
    confirmError ? CONFIRM_ERRORS[confirmError] ?? "That confirmation link could not be used." : null
  );
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    setSavingName(true);
    setNameError(null);
    setNameSuccess(null);

    const res = await fetch("/api/preferences/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    setSavingName(false);

    if (!res.ok) {
      setNameError(data.error || "Could not update your display name.");
      return;
    }
    setNameSuccess(data.message || "Display name updated.");
    // Refresh the JWT so the navbar/session shows the new name.
    void updateSession();
  }

  async function handleRequestEmailChange(e: React.FormEvent) {
    e.preventDefault();
    setSavingEmail(true);
    setEmailError(null);
    setEmailSuccess(null);

    const res = await fetch("/api/preferences/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, currentPassword }),
    });
    const data = await res.json().catch(() => ({}));
    setSavingEmail(false);

    if (!res.ok) {
      setEmailError(data.error || "Could not request the email change.");
      return;
    }
    setPendingEmail(data.pendingEmail);
    setEmail("");
    setCurrentPassword("");
    setEmailSuccess(data.message || "Confirmation link sent.");
  }

  async function handleCancelEmailChange() {
    setSavingEmail(true);
    setEmailError(null);
    setEmailSuccess(null);

    const res = await fetch("/api/preferences/email", { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setSavingEmail(false);

    if (!res.ok) {
      setEmailError(data.error || "Could not cancel the pending email change.");
      return;
    }
    setPendingEmail(null);
    setEmailSuccess(data.message || "Pending email change cancelled.");
  }

  return (
    <Card>
      <Card.Body>
        <Card.Title>Profile</Card.Title>

        <Form onSubmit={handleSaveName} className="mb-4">
          {nameError && (
            <Alert variant="danger" dismissible onClose={() => setNameError(null)}>
              {nameError}
            </Alert>
          )}
          {nameSuccess && (
            <Alert
              variant="success"
              dismissible
              onClose={() => setNameSuccess(null)}
            >
              {nameSuccess}
            </Alert>
          )}

          <Form.Group className="mb-3" controlId="profileName">
            <Form.Label>Display name</Form.Label>
            <Form.Control
              type="text"
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
            />
          </Form.Group>
          <Button type="submit" disabled={savingName}>
            {savingName ? <Spinner animation="border" size="sm" /> : "Save name"}
          </Button>
        </Form>

        <hr className="my-4" />

        <h6>Email address</h6>
        <Form.Text className="text-muted d-block mb-3">
          Your current address is <strong>{initial.email}</strong>. Changing it
          sends a confirmation link to the new address — you keep signing in
          with the current one until you click that link, so a typo can&apos;t
          lock you out.
        </Form.Text>

        {emailError && (
          <Alert variant="danger" dismissible onClose={() => setEmailError(null)}>
            {emailError}
          </Alert>
        )}
        {emailSuccess && (
          <Alert
            variant="success"
            dismissible
            onClose={() => setEmailSuccess(null)}
          >
            {emailSuccess}
          </Alert>
        )}

        {pendingEmail ? (
          <Alert variant="info" className="d-flex flex-wrap align-items-center gap-3">
            <span className="me-auto">
              Pending confirmation: <strong>{pendingEmail}</strong> — check that
              inbox.
            </span>
            <Button
              variant="outline-secondary"
              size="sm"
              disabled={savingEmail}
              onClick={handleCancelEmailChange}
            >
              Cancel change
            </Button>
          </Alert>
        ) : (
          <Form onSubmit={handleRequestEmailChange}>
            <Form.Group className="mb-3" controlId="profileNewEmail">
              <Form.Label>New email address</Form.Label>
              <Form.Control
                type="email"
                required
                placeholder="new@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Form.Group>
            <Form.Group className="mb-3" controlId="profileEmailPassword">
              <Form.Label>Current password</Form.Label>
              <Form.Control
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
              <Form.Text className="text-muted">
                Confirms it&apos;s really you before we move the account.
              </Form.Text>
            </Form.Group>
            <Button type="submit" disabled={savingEmail}>
              {savingEmail ? (
                <Spinner animation="border" size="sm" />
              ) : (
                "Send confirmation link"
              )}
            </Button>
          </Form>
        )}
      </Card.Body>
    </Card>
  );
}
