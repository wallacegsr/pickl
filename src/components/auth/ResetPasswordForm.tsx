"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, Form, Spinner } from "react-bootstrap";

/** Choosing a new password from an emailed link. */
export default function ResetPasswordForm({
  token,
  email,
  initialError,
}: {
  token: string | null;
  /** The account the link belongs to, shown so nobody resets the wrong one. */
  email: string | null;
  /** Set when the link was already known to be bad as the page loaded. */
  initialError: string | null;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (initialError) {
    return (
      <>
        <Alert variant="danger">{initialError}</Alert>
        <div className="d-grid gap-2">
          <Link href="/forgot-password" className="btn btn-primary">
            Send a new link
          </Link>
          <Link href="/login" className="btn btn-link btn-sm">
            Back to log in
          </Link>
        </div>
      </>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password, confirmPassword }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    setSaving(false);
    if (!res || !res.ok) {
      setError(data?.error || "Could not reset the password. Try again.");
      return;
    }
    router.push("/login?reset=1");
  }

  return (
    <>
      <p className="text-muted small">
        Choose a new password for <strong>{email}</strong>. Every device signed
        in to this account will be signed out.
      </p>
      {error && <Alert variant="danger">{error}</Alert>}
      <Form onSubmit={handleSubmit}>
        {/* The address, for password managers to file the new password under. */}
        <input type="email" name="username" autoComplete="username" value={email ?? ""} readOnly hidden />
        <Form.Group className="mb-3" controlId="password">
          <Form.Label>New password</Form.Label>
          <Form.Control
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Form.Text muted>At least 8 characters.</Form.Text>
        </Form.Group>
        <Form.Group className="mb-3" controlId="confirmPassword">
          <Form.Label>Confirm new password</Form.Label>
          <Form.Control
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </Form.Group>
        <div className="d-grid">
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner animation="border" size="sm" /> : "Set new password"}
          </Button>
        </div>
      </Form>
    </>
  );
}
