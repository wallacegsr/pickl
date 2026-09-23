"use client";

import { useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { Alert, Button, Form, Spinner } from "react-bootstrap";

export default function PasswordSettingsPanel() {
  const { data: session } = useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    const res = await fetch("/api/preferences/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);

    if (!res.ok) {
      setError(data.error || "Could not change your password.");
      return;
    }

    // The change ended every session older than it, this one included. Sign
    // back in with the new password so this device carries on where it was.
    const email = session?.user?.email;
    if (email) {
      await signIn("credentials", { email, password: newPassword, redirect: false });
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setSuccess(true);
  }

  return (
    // A plain section: this sits inside the settings page's own tabs, so a
    // card would be a box in a box and its title would repeat the tab.
    <section className="pickl-settings-section">
        <p className="text-muted small">
          Choose a new password of at least 8 characters. You&apos;ll stay
          signed in here; other devices will need the new password next time
          they sign in.
        </p>

        {error && (
          <Alert variant="danger" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {success && (
          <Alert variant="success" dismissible onClose={() => setSuccess(false)}>
            Your password has been changed. Use it the next time you sign in.
          </Alert>
        )}

        <Form onSubmit={handleSubmit}>
          <Form.Group className="mb-3" controlId="currentPassword">
            <Form.Label>Current password</Form.Label>
            <Form.Control
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Form.Group>
          <Form.Group className="mb-3" controlId="newPassword">
            <Form.Label>New password</Form.Label>
            <Form.Control
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Form.Group>
          <Form.Group className="mb-3" controlId="confirmNewPassword">
            <Form.Label>Confirm new password</Form.Label>
            <Form.Control
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Form.Group>
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner animation="border" size="sm" /> : "Change password"}
          </Button>
        </Form>
    </section>
  );
}
