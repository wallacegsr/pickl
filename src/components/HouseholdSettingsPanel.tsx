"use client";

import { useMemo, useState } from "react";
import { Alert, Button, Form } from "react-bootstrap";

/** Every zone this browser knows, for the picker. Falls back to a short list in an old browser. */
function timeZoneOptions(current: string | null): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = ["UTC", "Europe/London", "America/New_York", "America/Chicago", "America/Los_Angeles"];
  }
  return current && !zones.includes(current) ? [current, ...zones] : zones;
}

/**
 * A household admin's own household settings.
 *
 * Takes no household id — the endpoint reads it from the session — so there
 * is nothing here for anyone to point at a different household.
 */
export default function HouseholdSettingsPanel({
  initialName,
  suspended,
  initialTimeZone,
  serverTimeZone,
  initialApiAccess,
}: {
  initialName: string;
  suspended: boolean;
  initialTimeZone: string | null;
  /** What "no zone set" means: the server's own. */
  serverTimeZone: string;
  initialApiAccess: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [timeZone, setTimeZone] = useState(initialTimeZone ?? "");
  const [apiAccess, setApiAccess] = useState(initialApiAccess);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"name" | "api" | null>(null);
  const zones = useMemo(() => timeZoneOptions(initialTimeZone), [initialTimeZone]);

  async function patch(which: "name" | "api", body: object): Promise<Record<string, unknown> | null> {
    setSaving(which);
    setError(null);
    setSaved(null);
    const res = await fetch("/api/household", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(null);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error ?? "Could not save the household settings.");
      return null;
    }
    return data;
  }

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    const body = await patch("name", { name });
    if (!body) return;
    setName(String(body.name));
    setSaved(`Saved. This household is now called "${body.name}".`);
  }

  async function saveApi(e: React.FormEvent) {
    e.preventDefault();
    const body = await patch("api", { timeZone: timeZone || null, apiAccess });
    if (!body) return;
    setSaved(
      body.apiAccess
        ? "Saved. Everyone in the household can now create API tokens under Preferences."
        : "Saved. API tokens are turned off for this household."
    );
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

      <Form onSubmit={saveName} style={{ maxWidth: "28rem" }}>
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
        <Button type="submit" disabled={saving !== null || suspended || !name.trim()}>
          {saving === "name" ? "Saving…" : "Save"}
        </Button>
      </Form>

      <h5 className="mt-5">Home Assistant &amp; API</h5>
      <p className="text-muted">
        Let people in this household connect Pickl to Home Assistant or other
        tools with a personal API token. A token can only do what its owner
        already can, and turning this off stops every token at once.
      </p>

      <Form onSubmit={saveApi} style={{ maxWidth: "28rem" }}>
        <Form.Group className="mb-3" controlId="household-api-access">
          <Form.Check
            type="switch"
            label="Allow API tokens"
            checked={apiAccess}
            onChange={(e) => setApiAccess(e.target.checked)}
            disabled={suspended}
          />
        </Form.Group>
        <Form.Group className="mb-3" controlId="household-time-zone">
          <Form.Label>Time zone</Form.Label>
          <Form.Select
            value={timeZone}
            onChange={(e) => setTimeZone(e.target.value)}
            disabled={suspended}
          >
            <option value="">Server&rsquo;s time zone ({serverTimeZone})</option>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, " ")}
              </option>
            ))}
          </Form.Select>
          <Form.Text>
            Decides what &ldquo;today&rdquo; means for Home Assistant, and the times
            in the calendar feed. Pages in a browser always use the browser&rsquo;s own.
          </Form.Text>
        </Form.Group>
        <Button type="submit" disabled={saving !== null || suspended}>
          {saving === "api" ? "Saving…" : "Save"}
        </Button>
      </Form>
    </div>
  );
}
