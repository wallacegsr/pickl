"use client";

import { useState } from "react";
import { Alert, Button, Form, InputGroup, Table } from "react-bootstrap";

export interface ApiTokenRow {
  id: string;
  name: string;
  scope: "read" | "write" | "feed";
  hint: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

const SCOPE_LABELS: Record<ApiTokenRow["scope"], string> = {
  read: "Read only",
  write: "Read and change",
  feed: "Calendar feed",
};

const SCOPE_HELP: Record<ApiTokenRow["scope"], string> = {
  read: "Sees today's meals, the week, recipes and the shopping list. Changes nothing.",
  write:
    "Also decides today's meal, fills the week, and ticks off or adds to the shopping list.",
  feed: "A link for Home Assistant's Remote Calendar or any calendar app. Opens the calendar feed and nothing else.",
};

const DOCS_URL = "https://github.com/wallacegsr/pickl/blob/main/docs/api.md";

/** YYYY-MM-DD, the same on the server and in the browser, so the first render never disagrees. */
function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}

/**
 * The caller's own API tokens, for Home Assistant and similar. Self-service:
 * there is no view of anyone else's tokens, admin or not.
 */
export default function ApiTokensPanel({
  initialTokens,
  apiAccess,
  baseUrl,
}: {
  initialTokens: ApiTokenRow[];
  /** Whether the household lets tokens be created and used. */
  apiAccess: boolean;
  /** Where Pickl is served, for the URLs shown here. */
  baseUrl: string;
}) {
  const [tokens, setTokens] = useState(initialTokens);
  const [name, setName] = useState("Home Assistant");
  const [scope, setScope] = useState<ApiTokenRow["scope"]>("read");
  const [expires, setExpires] = useState<"" | "30" | "90" | "365">("");
  const [created, setCreated] = useState<{ value: string; scope: ApiTokenRow["scope"]; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    setCopied(false);
    const res = await fetch("/api/preferences/api-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, scope, expiresInDays: expires ? Number(expires) : null }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Could not create the token.");
      return;
    }
    setTokens((prev) => [data.summary as ApiTokenRow, ...prev]);
    const value =
      scope === "feed" ? `${baseUrl}/api/v1/calendar.ics?key=${data.token}` : (data.token as string);
    setCreated({ value, scope, name });
  }

  async function revoke(token: ApiTokenRow) {
    if (!window.confirm(`Revoke "${token.name}"? Anything using it stops working straight away.`)) return;
    setError(null);
    const res = await fetch(`/api/preferences/api-tokens/${encodeURIComponent(token.id)}`, {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 404) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not revoke the token.");
      return;
    }
    setTokens((prev) => prev.filter((t) => t.id !== token.id));
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <p className="text-muted">
        Personal tokens let Home Assistant — or anything else that speaks HTTP —
        read your meal plan and shopping list. A token acts as you, with exactly
        your permissions, and works until you revoke it. See the{" "}
        <a href={DOCS_URL} target="_blank" rel="noreferrer">
          API guide
        </a>{" "}
        for what each endpoint returns and example Home Assistant configuration.
      </p>

      {!apiAccess && (
        <Alert variant="info">
          API access is turned off for your household, so tokens can&rsquo;t be
          created and existing ones don&rsquo;t work. A household admin can turn
          it on under Back of House → Household.
        </Alert>
      )}

      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {created && (
        <Alert variant="success">
          <p className="mb-2">
            <strong>{created.scope === "feed" ? "Your calendar feed link" : `Your token for "${created.name}"`}</strong>
            {" — "}copy it now. Pickl keeps only a fingerprint of it, so it
            can&rsquo;t be shown again.
          </p>
          <InputGroup size="sm">
            <Form.Control
              readOnly
              value={created.value}
              aria-label="New token"
              onFocus={(e) => e.currentTarget.select()}
              className="font-monospace"
            />
            <Button variant="outline-success" onClick={() => copy(created.value)}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </InputGroup>
          {created.scope !== "feed" && (
            <p className="small mb-0 mt-2">
              Send it as <code>Authorization: Bearer &lt;token&gt;</code> to{" "}
              <code>{baseUrl}/api/v1/…</code>
            </p>
          )}
        </Alert>
      )}

      <Form onSubmit={create} className="mb-4" style={{ maxWidth: "32rem" }}>
        <Form.Group className="mb-3" controlId="api-token-name">
          <Form.Label>Name</Form.Label>
          <Form.Control
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            required
            disabled={!apiAccess}
          />
          <Form.Text>So you can tell your tokens apart, e.g. &ldquo;Home Assistant&rdquo;.</Form.Text>
        </Form.Group>
        <Form.Group className="mb-3" controlId="api-token-scope">
          <Form.Label>What it can do</Form.Label>
          <Form.Select
            value={scope}
            onChange={(e) => setScope(e.target.value as ApiTokenRow["scope"])}
            disabled={!apiAccess}
          >
            <option value="read">{SCOPE_LABELS.read}</option>
            <option value="write">{SCOPE_LABELS.write}</option>
            <option value="feed">{SCOPE_LABELS.feed}</option>
          </Form.Select>
          <Form.Text>{SCOPE_HELP[scope]}</Form.Text>
        </Form.Group>
        <Form.Group className="mb-3" controlId="api-token-expiry">
          <Form.Label>Expires</Form.Label>
          <Form.Select
            value={expires}
            onChange={(e) => setExpires(e.target.value as typeof expires)}
            disabled={!apiAccess}
          >
            <option value="">Never</option>
            <option value="30">In 30 days</option>
            <option value="90">In 90 days</option>
            <option value="365">In a year</option>
          </Form.Select>
        </Form.Group>
        <Button type="submit" disabled={!apiAccess || busy || !name.trim()}>
          {busy ? "Creating…" : "Create token"}
        </Button>
      </Form>

      <h6>Your tokens</h6>
      {tokens.length === 0 ? (
        <p className="text-muted fst-italic">None yet.</p>
      ) : (
        <div className="table-responsive">
          <Table size="sm" className="align-middle">
            <thead>
              <tr>
                <th>Name</th>
                <th>Access</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Expires</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => (
                <tr key={token.id}>
                  <td>
                    {token.name} <span className="text-body-secondary small font-monospace">…{token.hint}</span>
                  </td>
                  <td>{SCOPE_LABELS[token.scope]}</td>
                  <td>{day(token.createdAt)}</td>
                  <td>{token.lastUsedAt ? day(token.lastUsedAt) : "Never"}</td>
                  <td>{token.expiresAt ? day(token.expiresAt) : "Never"}</td>
                  <td className="text-end">
                    <Button size="sm" variant="outline-danger" onClick={() => revoke(token)}>
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
}
