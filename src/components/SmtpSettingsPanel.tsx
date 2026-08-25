"use client";

import { useState } from "react";
import { Alert, Button, Card, Col, Form, Row, Spinner } from "react-bootstrap";

export interface SmtpSettingsInitial {
  smtpHost: string;
  smtpPort: number | null;
  smtpUser: string;
  smtpFrom: string;
  hasPassword: boolean;
}

const MASKED_PASSWORD_PLACEHOLDER = "••••••••";

export default function SmtpSettingsPanel({
  initialSettings,
}: {
  initialSettings: SmtpSettingsInitial;
}) {
  const [host, setHost] = useState(initialSettings.smtpHost);
  const [port, setPort] = useState(
    initialSettings.smtpPort ? String(initialSettings.smtpPort) : ""
  );
  const [user, setUser] = useState(initialSettings.smtpUser);
  const [password, setPassword] = useState("");
  const [from, setFrom] = useState(initialSettings.smtpFrom);
  const [hasPassword, setHasPassword] = useState(initialSettings.hasPassword);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: true; message: string } | { ok: false; message: string } | null
  >(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    setTestResult(null);

    const res = await fetch("/api/admin/smtp-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        smtpHost: host,
        smtpPort: port.trim() === "" ? null : Number(port),
        smtpUser: user,
        smtpPassword: password,
        smtpFrom: from,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);

    if (!res.ok) {
      setSaveError(data.error || "Could not save SMTP settings.");
      return;
    }

    setHasPassword(Boolean(data.hasPassword));
    setPassword("");
    setSaveSuccess(true);
  }

  async function handleTest(e: React.FormEvent) {
    e.preventDefault();
    setTesting(true);
    setTestResult(null);

    const res = await fetch("/api/admin/smtp-settings/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: testTo }),
    });
    const data = await res.json().catch(() => ({}));
    setTesting(false);

    if (!res.ok) {
      setTestResult({
        ok: false,
        message: data.error || "Failed to send test email.",
      });
      return;
    }
    setTestResult({ ok: true, message: data.message || "Test email sent." });
  }

  return (
    <Card className="mt-4">
      <Card.Body>
        <Card.Title>SMTP Settings</Card.Title>
        <Card.Text className="text-muted small">
          Configure the SMTP server used to send verification and invite
          emails. These settings, once saved here, take precedence over the
          server&apos;s <code>SMTP_*</code> environment variables (which
          still work as a fallback default before any settings are saved
          here). Leave <strong>Host</strong> blank to fall back to the
          environment variables (or console-logging, if neither is
          configured).
        </Card.Text>

        {saveError && (
          <Alert variant="danger" dismissible onClose={() => setSaveError(null)}>
            {saveError}
          </Alert>
        )}
        {saveSuccess && (
          <Alert variant="success" dismissible onClose={() => setSaveSuccess(false)}>
            SMTP settings saved.
          </Alert>
        )}

        <Form onSubmit={handleSave}>
          <Row>
            <Col md={8}>
              <Form.Group className="mb-3" controlId="smtpHost">
                <Form.Label>Host</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="smtp.example.com"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                />
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group className="mb-3" controlId="smtpPort">
                <Form.Label>Port</Form.Label>
                <Form.Control
                  type="number"
                  min={1}
                  max={65535}
                  placeholder="587"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                />
              </Form.Group>
            </Col>
          </Row>
          <Row>
            <Col md={6}>
              <Form.Group className="mb-3" controlId="smtpUser">
                <Form.Label>Username</Form.Label>
                <Form.Control
                  type="text"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3" controlId="smtpPassword">
                <Form.Label>Password</Form.Label>
                <Form.Control
                  type="password"
                  placeholder={
                    hasPassword ? MASKED_PASSWORD_PLACEHOLDER : "(none set)"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <Form.Text className="text-muted">
                  Leave blank to keep the current password.
                </Form.Text>
              </Form.Group>
            </Col>
          </Row>
          <Form.Group className="mb-3" controlId="smtpFrom">
            <Form.Label>From address</Form.Label>
            <Form.Control
              type="text"
              placeholder="Pickl <no-reply@yourdomain.com>"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Form.Group>

          <Button type="submit" disabled={saving}>
            {saving ? <Spinner animation="border" size="sm" /> : "Save"}
          </Button>
        </Form>

        <hr className="my-4" />

        <h6>Send test email</h6>
        <Form.Text className="text-muted d-block mb-2">
          Uses the settings currently saved above — save your settings
          first if you just changed them.
        </Form.Text>

        {testResult && (
          <Alert
            variant={testResult.ok ? "success" : "danger"}
            dismissible
            onClose={() => setTestResult(null)}
          >
            {testResult.message}
          </Alert>
        )}

        <Form onSubmit={handleTest}>
          <Row className="align-items-end">
            <Col md={8}>
              <Form.Group controlId="testEmailTo">
                <Form.Label>Send to</Form.Label>
                <Form.Control
                  type="email"
                  required
                  placeholder="you@example.com"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                />
              </Form.Group>
            </Col>
            <Col md={4}>
              <Button
                type="submit"
                variant="outline-secondary"
                disabled={testing}
                className="mt-2 mt-md-0"
              >
                {testing ? (
                  <Spinner animation="border" size="sm" />
                ) : (
                  "Send Test Email"
                )}
              </Button>
            </Col>
          </Row>
        </Form>
      </Card.Body>
    </Card>
  );
}
