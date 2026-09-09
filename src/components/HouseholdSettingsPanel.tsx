"use client";

import { useState } from "react";
import { Alert, Button, Form } from "react-bootstrap";

/**
 * A household admin's own household settings.
 *
 * Takes no household id — the endpoint reads it from the session — so there
 * is nothing here for anyone to point at a different household.
 */
export default function HouseholdSettingsPanel({
  initialName,
  suspended,
}: {
  initialName: string;
  suspended: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(null);

    const res = await fetch("/api/household", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Could not save the household name.");
      return;
    }
    const body = await res.json();
    setName(body.name);
    setSaved(`Saved. This household is now called "${body.name}".`);
  }

  return (
    <div>
      <p className="text-muted">
        What this household is called. Everyone in it sees the same name.
      </p>

      {suspended && (
        <Alert variant="warning">
          This household is suspended. You can still read everything here, but
          nothing can be changed until the administrator of this deployment
          resumes it.
        </Alert>
      )}

      {error && <Alert variant="danger">{error}</Alert>}
      {saved && <Alert variant="success">{saved}</Alert>}

      <Form onSubmit={save} style={{ maxWidth: "28rem" }}>
        <Form.Group className="mb-3" controlId="household-name">
          <Form.Label>Household name</Form.Label>
          <Form.Control
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            disabled={suspended}
          />
        </Form.Group>
        <Button type="submit" disabled={saving || suspended || !name.trim()}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </Form>
    </div>
  );
}
