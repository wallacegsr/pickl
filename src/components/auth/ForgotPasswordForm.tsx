"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Button, Form, Spinner } from "react-bootstrap";

/**
 * Asks for an email and sends a reset link. After sending it says the same
 * thing for every address — see /api/auth/forgot-password for why.
 */
export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    setSending(false);
    if (!res || !res.ok) {
      setError(data?.error || "Could not send that right now. Try again in a moment.");
      return;
    }
    setSent(data.message);
  }

  if (sent) {
    return (
      <>
        <Alert variant="success">{sent}</Alert>
        <p className="small text-muted">
          Nothing arrived? Check spam, and that it&apos;s the address you signed
          up with.
        </p>
        <div className="text-center small">
          <Link href="/login">Back to log in</Link>
        </div>
      </>
    );
  }

  return (
    <>
      <p className="text-muted small">
        Enter the email you log in with and we&apos;ll send a link to choose a new
        password.
      </p>
      {error && <Alert variant="danger">{error}</Alert>}
      <Form onSubmit={handleSubmit}>
        <Form.Group className="mb-3" controlId="email">
          <Form.Label>Email</Form.Label>
          <Form.Control
            type="email"
            required
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Form.Group>
        <div className="d-grid">
          <Button type="submit" disabled={sending}>
            {sending ? <Spinner animation="border" size="sm" /> : "Send reset link"}
          </Button>
        </div>
      </Form>
      <div className="text-center mt-3 small">
        <Link href="/login">Back to log in</Link>
      </div>
    </>
  );
}
