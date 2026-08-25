"use client";

import { useState } from "react";
import { Alert, Button, Card, Form, InputGroup, Spinner } from "react-bootstrap";

export interface GoogleOAuthSettingsInitial {
  clientId: string;
  hasClientSecret: boolean;
  enabled: boolean;
  /** Computed server-side from APP_BASE_URL / NEXTAUTH_URL. */
  redirectUri: string;
}

const MASKED_SECRET_PLACEHOLDER = "•••••••• (a client secret is stored)";

/**
 * Admin → Calendar Integration.
 *
 * This panel configures OAuth CLIENT credentials and nothing else. There
 * is deliberately no view of who has connected an account, which calendars
 * they chose, or any way to sync on their behalf — each user's connection
 * is theirs alone, enforced server-side in /api/calendar/**.
 */
export default function GoogleOAuthSettingsPanel({
  initialSettings,
}: {
  initialSettings: GoogleOAuthSettingsInitial;
}) {
  const [clientId, setClientId] = useState(initialSettings.clientId);
  const [clientSecret, setClientSecret] = useState("");
  const [enabled, setEnabled] = useState(initialSettings.enabled);
  const [hasClientSecret, setHasClientSecret] = useState(
    initialSettings.hasClientSecret
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    const res = await fetch("/api/admin/google-oauth", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, clientSecret, enabled }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);

    if (!res.ok) {
      setError(data.error || "Could not save the OAuth client settings.");
      return;
    }
    setHasClientSecret(Boolean(data.hasClientSecret));
    setClientSecret("");
    setSuccess(true);
  }

  async function copyRedirectUri() {
    try {
      await navigator.clipboard.writeText(initialSettings.redirectUri);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure origin, say) — the value is selectable
      // text either way, so there is nothing to recover from.
    }
  }

  return (
    <Card className="mt-4">
      <Card.Body>
        <Card.Title>Calendar Integration (Google OAuth)</Card.Title>
        <Card.Text className="text-muted small">
          Each user connects their <strong>own</strong> Google account from{" "}
          <strong>Preferences → Calendars</strong> and mirrors the household
          plan (and, if they like, their private plan) into a calendar of
          their choosing. This page only holds the OAuth{" "}
          <strong>client</strong> credentials the whole deployment shares —
          the same category of setting as SMTP. Administrators cannot see or
          operate anyone else&apos;s calendar connection.
        </Card.Text>

        {error && (
          <Alert variant="danger" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {success && (
          <Alert variant="success" dismissible onClose={() => setSuccess(false)}>
            OAuth client settings saved.
          </Alert>
        )}

        <Form.Group className="mb-3">
          <Form.Label>Authorized redirect URI</Form.Label>
          <InputGroup>
            <Form.Control
              readOnly
              value={initialSettings.redirectUri}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Authorized redirect URI to register in Google Cloud"
            />
            <Button variant="outline-secondary" onClick={copyRedirectUri}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </InputGroup>
          <Form.Text className="text-muted">
            Paste this into your OAuth client&apos;s{" "}
            <em>Authorized redirect URIs</em> in Google Cloud, exactly as
            shown. It is derived from this server&apos;s{" "}
            <code>APP_BASE_URL</code> / <code>NEXTAUTH_URL</code> — if those
            do not match the URL people actually visit, Google will reject
            every sign-in with <code>redirect_uri_mismatch</code>.
          </Form.Text>
        </Form.Group>

        <Form onSubmit={handleSave}>
          <Form.Group className="mb-3" controlId="googleClientId">
            <Form.Label>Client ID</Form.Label>
            <Form.Control
              type="text"
              placeholder="1234567890-abcdefg.apps.googleusercontent.com"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            />
          </Form.Group>

          <Form.Group className="mb-3" controlId="googleClientSecret">
            <Form.Label>Client secret</Form.Label>
            <Form.Control
              type="password"
              placeholder={
                hasClientSecret ? MASKED_SECRET_PLACEHOLDER : "(none set)"
              }
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              autoComplete="new-password"
            />
            <Form.Text className="text-muted">
              Leave blank to keep the current secret. It is encrypted at rest
              and never sent back to the browser.
            </Form.Text>
          </Form.Group>

          <Form.Check
            type="switch"
            id="googleOauthEnabled"
            className="mb-3"
            label="Enable Google Calendar sync for this deployment"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />

          <Button type="submit" disabled={saving}>
            {saving ? <Spinner animation="border" size="sm" /> : "Save"}
          </Button>
        </Form>

        <hr className="my-4" />

        <h6>Setup steps</h6>
        <ol className="small text-muted ps-3 mb-3">
          <li>
            In the{" "}
            <a
              href="https://console.cloud.google.com/"
              target="_blank"
              rel="noreferrer"
            >
              Google Cloud console
            </a>
            , create (or pick) a project.
          </li>
          <li>
            Enable the <strong>Google Calendar API</strong> for that project.
          </li>
          <li>
            Create an <strong>OAuth client ID</strong> of type{" "}
            <strong>Web application</strong>.
          </li>
          <li>
            Add the <strong>redirect URI shown above</strong> to that
            client&apos;s authorized redirect URIs.
          </li>
          <li>
            Paste the client ID and client secret into the fields above, tick
            Enable, and Save.
          </li>
          <li>
            On the <strong>OAuth consent screen</strong>, set the publishing
            status to <strong>In production</strong>. See the warning below.
          </li>
        </ol>

        <Alert variant="warning" className="small mb-0">
          <strong>
            Leave the OAuth consent screen in &ldquo;Testing&rdquo; and Google
            will expire everyone&apos;s authorization after about 7 days
          </strong>
          , forcing every user in the household to reconnect weekly. Setting
          the consent screen to <strong>In production</strong> fixes this. For
          a private household app that does <em>not</em> mean going through
          Google&apos;s formal verification review — it just means each person
          accepts a one-time &ldquo;Google hasn&apos;t verified this
          app&rdquo; warning the first time they connect.
        </Alert>
      </Card.Body>
    </Card>
  );
}
