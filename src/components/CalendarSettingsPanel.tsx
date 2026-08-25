"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Form,
  Modal,
  Spinner,
} from "react-bootstrap";
import type {
  CalendarPanelState,
  CalendarTargetState,
} from "@/lib/calendar/panelState";

/**
 * Preferences → Calendars.
 *
 * Every request this component makes is unparameterised by user: the
 * server derives the owner from the session. There is no user id in any
 * payload here, deliberately — see /api/calendar/targets.
 *
 * Two providers can be connected at once (Google and CalDAV), but a plan
 * has at most ONE target, so the per-plan picker lists both providers'
 * calendars in one select and the chosen option carries its provider with
 * it.
 *
 * Copy rule for this panel: the playful voice lives in headers and empty
 * states. A credentials form is not the place for jokes — someone reading
 * it is trying to get their password right.
 */

export type { CalendarPanelState, CalendarTargetState };

interface CalendarOption {
  /** Google calendar id, or CalDAV collection URL. */
  value: string;
  label: string;
  provider: "google" | "caldav";
  /** Google only. */
  primary?: boolean;
  /** CalDAV only: the server said we have read-only access. */
  readOnly?: boolean;
}

const PLANS: Array<{ scope: "shared" | "private"; label: string; hint: string }> = [
  {
    scope: "shared",
    label: "Household plan",
    hint: "Meals planned on the shared household calendar.",
  },
  {
    scope: "private",
    label: "My private plan",
    hint: "Meals planned on your own private calendar. Nobody else sees these.",
  },
];

/**
 * Where each provider hides its CalDAV URL, and which of them force an
 * app-specific password. Short and factual — these are the four services
 * people actually ask about.
 */
const CALDAV_HINTS: Array<{ name: string; url: string; note: string }> = [
  {
    name: "Fastmail",
    url: "https://caldav.fastmail.com/",
    note: "Requires an app password: Settings → Privacy & Security → Integrations → App passwords, with CalDAV access.",
  },
  {
    name: "iCloud",
    url: "https://caldav.icloud.com/",
    note: "Requires an app-specific password from account.apple.com → Sign-In and Security. Your username is your Apple ID email.",
  },
  {
    name: "Nextcloud",
    url: "https://your-server/remote.php/dav/",
    note: "Your normal username works, but generate a device password under Settings → Security instead.",
  },
  {
    name: "Synology Calendar",
    url: "https://your-nas:5001/caldav/",
    note: "Your DSM username and password. The NAS must be reachable over HTTPS with a valid certificate.",
  },
];

function formatTimestamp(value: string | null): string {
  if (!value) return "never";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "never" : d.toLocaleString();
}

/**
 * Encodes provider + id into one <option value>, since one select spans
 * both providers. "::" cannot collide with the provider half (which is
 * always "google" or "caldav"), and only the FIRST occurrence is treated
 * as the separator, so a CalDAV URL containing one is preserved intact.
 */
const SEPARATOR = "::";

function optionKey(provider: "google" | "caldav", value: string): string {
  return `${provider}${SEPARATOR}${value}`;
}

function parseOptionKey(key: string): { provider: "google" | "caldav"; value: string } | null {
  if (!key) return null;
  const separator = key.indexOf(SEPARATOR);
  if (separator === -1) return null;
  const provider = key.slice(0, separator);
  if (provider !== "google" && provider !== "caldav") return null;
  return { provider, value: key.slice(separator + SEPARATOR.length) };
}

export default function CalendarSettingsPanel({
  initialState,
  initialMessage,
  initialError,
}: {
  initialState: CalendarPanelState;
  initialMessage?: string;
  initialError?: string;
}) {
  const [state, setState] = useState(initialState);
  const [googleCalendars, setGoogleCalendars] = useState<CalendarOption[] | null>(null);
  const [caldavCalendars, setCaldavCalendars] = useState<CalendarOption[] | null>(null);
  const [calendarsError, setCalendarsError] = useState<string | null>(null);
  const [loadingCalendars, setLoadingCalendars] = useState(false);

  const [message, setMessage] = useState<string | null>(initialMessage ?? null);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [busyScope, setBusyScope] = useState<string | null>(null);
  const [syncingScope, setSyncingScope] = useState<string | null>(null);
  const [savingOverlay, setSavingOverlay] = useState(false);
  const [showDisconnect, setShowDisconnect] = useState<null | "google" | "caldav">(null);
  const [disconnecting, setDisconnecting] = useState(false);

  // --- CalDAV connect form -------------------------------------------------
  const [serverUrl, setServerUrl] = useState(initialState.caldav.serverUrl);
  const [username, setUsername] = useState(initialState.caldav.username);
  const [password, setPassword] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [caldavFormError, setCaldavFormError] = useState<string | null>(null);
  const [showHints, setShowHints] = useState(false);

  const loadGoogleCalendars = useCallback(async () => {
    const res = await fetch("/api/calendar/calendars");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setCalendarsError(data.error || "Could not load your Google calendars.");
      setGoogleCalendars([]);
      return;
    }
    setGoogleCalendars(
      (data.calendars ?? []).map(
        (c: { id: string; summary: string; primary: boolean }): CalendarOption => ({
          value: c.id,
          label: c.summary,
          provider: "google",
          primary: c.primary,
        })
      )
    );
  }, []);

  const loadCaldavCalendars = useCallback(async () => {
    const res = await fetch("/api/calendar/caldav/calendars");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setCalendarsError(data.error || "Could not load your CalDAV calendars.");
      setCaldavCalendars([]);
      return;
    }
    setCaldavCalendars(
      (data.calendars ?? []).map(
        (c: { url: string; displayName: string; writable: boolean }): CalendarOption => ({
          value: c.url,
          label: c.displayName,
          provider: "caldav",
          readOnly: !c.writable,
        })
      )
    );
  }, []);

  const loadCalendars = useCallback(async () => {
    setLoadingCalendars(true);
    setCalendarsError(null);
    const jobs: Array<Promise<void>> = [];
    if (state.connected) jobs.push(loadGoogleCalendars());
    else setGoogleCalendars(null);
    if (state.caldav.connected) jobs.push(loadCaldavCalendars());
    else setCaldavCalendars(null);
    await Promise.all(jobs);
    setLoadingCalendars(false);
  }, [state.connected, state.caldav.connected, loadGoogleCalendars, loadCaldavCalendars]);

  useEffect(() => {
    if (state.connected || state.caldav.connected) void loadCalendars();
  }, [state.connected, state.caldav.connected, loadCalendars]);

  const anyConnected = state.connected || state.caldav.connected;
  const allOptions: CalendarOption[] = [
    ...(googleCalendars ?? []),
    ...(caldavCalendars ?? []),
  ];

  function targetFor(scope: string): CalendarTargetState | undefined {
    return state.targets.find((t) => t.scope === scope);
  }

  async function refreshState() {
    const res = await fetch("/api/calendar/targets");
    if (res.ok) setState(await res.json());
  }

  async function saveTarget(
    scope: "shared" | "private",
    patch: {
      selection?: { provider: "google" | "caldav"; value: string } | null;
      includeDetail?: boolean;
      enabled?: boolean;
    }
  ) {
    const current = targetFor(scope);
    const selection =
      patch.selection !== undefined
        ? patch.selection
        : current
          ? { provider: current.provider, value: current.calendarId }
          : null;
    const chosen = selection
      ? allOptions.find(
          (o) => o.provider === selection.provider && o.value === selection.value
        )
      : undefined;

    setBusyScope(scope);
    setError(null);
    setMessage(null);

    const res = await fetch("/api/calendar/targets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope,
        provider: selection?.provider ?? current?.provider ?? "google",
        calendarId: selection?.value || null,
        calendarName: chosen?.label ?? current?.calendarName ?? null,
        includeDetail:
          patch.includeDetail !== undefined
            ? patch.includeDetail
            : current?.includeDetail ?? false,
        enabled:
          patch.enabled !== undefined ? patch.enabled : current?.enabled ?? true,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusyScope(null);

    if (!res.ok) {
      setError(data.error || "Could not save that calendar setting.");
      return;
    }
    setState(data);
    setMessage("Calendar settings saved.");
  }

  async function syncNow(scope: "shared" | "private") {
    setSyncingScope(scope);
    setError(null);
    setMessage(null);
    const res = await fetch("/api/calendar/targets/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope }),
    });
    const data = await res.json().catch(() => ({}));
    setSyncingScope(null);

    await refreshState();

    if (!res.ok || data.error) {
      setError(data.error || "Sync failed.");
      return;
    }
    setMessage(
      `Synced this week: ${data.created} created, ${data.updated} updated, ${data.deleted} removed.`
    );
  }

  async function handleCaldavConnect(e: React.FormEvent) {
    e.preventDefault();
    setConnecting(true);
    setCaldavFormError(null);
    setError(null);
    setMessage(null);

    const res = await fetch("/api/calendar/caldav/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverUrl, username, password }),
    });
    const data = await res.json().catch(() => ({}));
    setConnecting(false);

    if (!res.ok) {
      // The server's actual complaint, not a generic one — the fix for a
      // rejected password is nothing like the fix for a TLS error.
      setCaldavFormError(data.error || "Could not connect to that CalDAV server.");
      return;
    }

    setPassword("");
    setState(data.state);
    setCaldavCalendars(
      (data.calendars ?? []).map(
        (c: { url: string; displayName: string; writable: boolean }): CalendarOption => ({
          value: c.url,
          label: c.displayName,
          provider: "caldav",
          readOnly: !c.writable,
        })
      )
    );
    setMessage(
      `Connected. Found ${data.calendars?.length ?? 0} calendar${
        data.calendars?.length === 1 ? "" : "s"
      } — choose one for a plan below.`
    );
  }

  /**
   * The overlay opt-in. Optimistic, because the switch flipping back on a
   * failure is clearer feedback than a spinner, and the state is refreshed
   * from the server either way.
   */
  async function saveOverlayPreference(enabled: boolean) {
    setSavingOverlay(true);
    setError(null);
    setMessage(null);
    setState((prev) => ({ ...prev, overlayEnabled: enabled }));

    const res = await fetch("/api/calendar/overlay/preference", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }).catch(() => null);
    setSavingOverlay(false);

    if (!res || !res.ok) {
      setState((prev) => ({ ...prev, overlayEnabled: !enabled }));
      setError("Could not save that setting.");
      return;
    }
    setMessage(
      enabled
        ? "Your calendar events will show on the plan grid — only for you."
        : "Your calendar events are hidden. Pickl won't read your calendar."
    );
  }

  async function handleDisconnect() {
    const which = showDisconnect;
    if (!which) return;
    setDisconnecting(true);
    const res = await fetch(
      which === "google"
        ? "/api/calendar/google/disconnect"
        : "/api/calendar/caldav/disconnect",
      { method: "POST" }
    );
    const data = await res.json().catch(() => ({}));
    setDisconnecting(false);
    setShowDisconnect(null);
    if (which === "google") setGoogleCalendars(null);
    else {
      setCaldavCalendars(null);
      setPassword("");
    }
    await refreshState();
    if (!res.ok) {
      setError(data.error || "Could not disconnect.");
      return;
    }
    setMessage(data.message || "Calendar disconnected.");
  }

  return (
    <Card className="mt-4">
      <Card.Body>
        <Card.Title>Calendars</Card.Title>
        <Card.Text className="text-muted small">
          Mirror your planned meals into your own calendar — Google Calendar,
          or any CalDAV server (Fastmail, iCloud, Nextcloud, Synology and
          friends). Events are <strong>title-only</strong> by default (for
          example <em>Dinner: Spaghetti Bolognese</em>) — turn on
          &ldquo;include recipe details&rdquo; per plan if you also want
          ingredients and instructions in the event description.
        </Card.Text>

        {error && (
          <Alert variant="danger" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {message && (
          <Alert variant="success" dismissible onClose={() => setMessage(null)}>
            {message}
          </Alert>
        )}

        {/* ---------------------------------------------------------------
            Google
            --------------------------------------------------------------- */}
        <h6 className="mt-3">Google Calendar</h6>

        {!state.oauthConfigured && !state.connected && (
          <Alert variant="secondary" className="small">
            <strong>Google Calendar sync isn&apos;t set up on this server yet.</strong>
            <div className="mt-1">
              An administrator needs to add Google OAuth client credentials
              under <strong>Admin → Calendar Integration</strong> before
              anyone can connect a Google account. CalDAV below needs no
              server-side setup at all.
            </div>
          </Alert>
        )}

        {state.oauthConfigured && !state.connected && (
          <div className="mb-3">
            <Button href="/api/calendar/google/connect">
              Connect Google Calendar
            </Button>
            <div className="text-muted small mt-2">
              You&apos;ll be sent to Google to authorize access. Pickl asks
              only to manage calendar events and to read the list of your
              calendars. It won&apos;t read any of your existing events
              unless you switch on &ldquo;show my calendar on the
              plan&rdquo; below — and even then it never stores them.
            </div>
          </div>
        )}

        {state.connected && (
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
            <div>
              <Badge bg="success" className="me-2">
                Connected
              </Badge>
              <span>{state.accountEmail ?? "Google account"}</span>
            </div>
            <Button
              variant="outline-danger"
              size="sm"
              onClick={() => setShowDisconnect("google")}
            >
              Disconnect
            </Button>
          </div>
        )}

        {state.connected && state.accountError && (
          <Alert variant="warning">
            <strong>Reconnect your Google account.</strong>
            <div className="small mt-1">{state.accountError}</div>
            <Button className="mt-2" size="sm" href="/api/calendar/google/connect">
              Reconnect Google Calendar
            </Button>
          </Alert>
        )}

        {/* ---------------------------------------------------------------
            CalDAV
            --------------------------------------------------------------- */}
        <hr />
        <h6>CalDAV server</h6>

        {state.caldav.connected && (
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
            <div>
              <Badge bg="success" className="me-2">
                Connected
              </Badge>
              <span>
                {state.caldav.username}
                {state.caldav.serverUrl ? ` at ${state.caldav.serverUrl}` : ""}
              </span>
            </div>
            <Button
              variant="outline-danger"
              size="sm"
              onClick={() => setShowDisconnect("caldav")}
            >
              Disconnect
            </Button>
          </div>
        )}

        {state.caldav.accountError && (
          <Alert variant="warning" className="small">
            <strong>Your CalDAV server rejected the stored credentials.</strong>
            <div className="mt-1">{state.caldav.accountError}</div>
          </Alert>
        )}

        <Alert variant="warning" className="small">
          <strong>Use an app-specific password, not your account password.</strong>
          <div className="mt-1">
            Pickl has to store this password in a recoverable form to talk to
            your server, so give it a credential you can revoke on its own.
            iCloud and Fastmail require one; Nextcloud and Synology let you
            create one, and you should.
          </div>
        </Alert>

        <Form onSubmit={(e) => void handleCaldavConnect(e)} className="mb-2">
          <Form.Group className="mb-2" controlId="caldav-url">
            <Form.Label>Server URL</Form.Label>
            <Form.Control
              type="url"
              value={serverUrl}
              placeholder="https://caldav.fastmail.com/"
              autoComplete="off"
              onChange={(e) => setServerUrl(e.target.value)}
            />
            <Form.Text className="text-muted">
              Must start with <code>https://</code>. Your password is sent to
              this server on every request, so Pickl will not use a plain
              <code> http://</code> address.
            </Form.Text>
          </Form.Group>

          <Form.Group className="mb-2" controlId="caldav-username">
            <Form.Label>Username</Form.Label>
            <Form.Control
              type="text"
              value={username}
              autoComplete="username"
              onChange={(e) => setUsername(e.target.value)}
            />
          </Form.Group>

          <Form.Group className="mb-2" controlId="caldav-password">
            <Form.Label>App password</Form.Label>
            <Form.Control
              type="password"
              value={password}
              autoComplete="new-password"
              placeholder={
                state.caldav.hasPassword
                  ? "Leave blank to keep the saved password"
                  : ""
              }
              onChange={(e) => setPassword(e.target.value)}
            />
            {state.caldav.hasPassword && (
              <Form.Text className="text-muted">
                A password is saved. Leave this blank unless you want to
                replace it — it is never shown again.
              </Form.Text>
            )}
          </Form.Group>

          {caldavFormError && (
            <Alert variant="danger" className="small py-2">
              {caldavFormError}
            </Alert>
          )}

          <Button type="submit" disabled={connecting}>
            {connecting ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Checking…
              </>
            ) : state.caldav.connected ? (
              "Save and re-discover calendars"
            ) : (
              "Connect"
            )}
          </Button>
          <Button
            variant="link"
            size="sm"
            className="ms-2"
            onClick={() => setShowHints((v) => !v)}
          >
            {showHints ? "Hide setup hints" : "Where do I find my server URL?"}
          </Button>
        </Form>

        {showHints && (
          <div className="border rounded p-3 mb-3 small">
            {CALDAV_HINTS.map((hint) => (
              <div key={hint.name} className="mb-2">
                <strong>{hint.name}</strong> — <code>{hint.url}</code>
                <div className="text-muted">{hint.note}</div>
              </div>
            ))}
            <div className="text-muted">
              Pickl finds your calendars from the base address, so you
              usually do not need the full path to a specific calendar.
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------------
            Read-back overlay (opt-in)
            --------------------------------------------------------------- */}
        <hr />
        <h6>Show my calendar on the plan</h6>
        <Form.Check
          type="switch"
          id="calendar-overlay-enabled"
          className="mb-2"
          label="Show my own calendar events alongside the meal plan"
          checked={state.overlayEnabled}
          disabled={savingOverlay}
          onChange={(e) => void saveOverlayPreference(e.target.checked)}
        />
        <div className="text-muted small">
          Off by default. When it&apos;s on, Pickl reads the week you&apos;re
          looking at from the calendar you&apos;ve connected for that plan
          and draws your events next to the meal slots — so you can see the
          soccer practice before you plan a roast.
          <ul className="mb-0 mt-2">
            <li>
              <strong>Only you see them.</strong> The household plan is
              shared; these events are not. Everyone looking at the same week
              sees their own calendar, and nobody — administrators
              included — sees yours.
            </li>
            <li>
              <strong>Nothing is stored.</strong> Events are fetched when you
              open the page and thrown away afterwards. They never reach
              Pickl&apos;s database.
            </li>
            <li>
              <strong>Google Calendar only for now.</strong> CalDAV
              connections can still receive your meals, but can&apos;t be read
              back yet.
            </li>
          </ul>
        </div>

        {/* ---------------------------------------------------------------
            Per-plan targets (shared by both providers)
            --------------------------------------------------------------- */}
        {anyConnected && (
          <>
            <hr />
            <h6>What gets synced</h6>

            {calendarsError && (
              <Alert variant="warning" className="small">
                {calendarsError}
              </Alert>
            )}

            {loadingCalendars && (
              <div className="text-muted small mb-3">
                <Spinner animation="border" size="sm" className="me-2" />
                Loading your calendars…
              </div>
            )}

            {PLANS.map((plan) => {
              const target = targetFor(plan.scope);
              const busy = busyScope === plan.scope;
              const selectedKey = target
                ? optionKey(target.provider, target.calendarId)
                : "";
              const knownSelection =
                target &&
                allOptions.some(
                  (o) => o.provider === target.provider && o.value === target.calendarId
                );

              return (
                <div key={plan.scope} className="border rounded p-3 mb-3">
                  <h6 className="mb-1">{plan.label}</h6>
                  <div className="text-muted small mb-3">{plan.hint}</div>

                  <Form.Group className="mb-3" controlId={`cal-${plan.scope}`}>
                    <Form.Label>Target calendar</Form.Label>
                    <Form.Select
                      value={selectedKey}
                      disabled={busy || allOptions.length === 0}
                      onChange={(e) =>
                        void saveTarget(plan.scope, {
                          selection: parseOptionKey(e.target.value),
                        })
                      }
                    >
                      <option value="">Don&apos;t sync</option>
                      {/* Keep a previously-chosen calendar selectable even if
                          the list failed to load or no longer contains it. */}
                      {target && !knownSelection && (
                        <option value={selectedKey}>
                          {target.calendarName || target.calendarId}
                        </option>
                      )}
                      {googleCalendars && googleCalendars.length > 0 && (
                        <optgroup label="Google Calendar">
                          {googleCalendars.map((c) => (
                            <option key={c.value} value={optionKey("google", c.value)}>
                              {c.label}
                              {c.primary ? " (primary)" : ""}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {caldavCalendars && caldavCalendars.length > 0 && (
                        <optgroup label="CalDAV">
                          {caldavCalendars.map((c) => (
                            <option
                              key={c.value}
                              value={optionKey("caldav", c.value)}
                              disabled={c.readOnly}
                            >
                              {c.label}
                              {c.readOnly ? " (read-only)" : ""}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </Form.Select>
                  </Form.Group>

                  {target && (
                    <>
                      <Form.Check
                        type="switch"
                        id={`detail-${plan.scope}`}
                        className="mb-2"
                        label="Include recipe details (ingredients and instructions) in the event"
                        checked={target.includeDetail}
                        disabled={busy}
                        onChange={(e) =>
                          void saveTarget(plan.scope, {
                            includeDetail: e.target.checked,
                          })
                        }
                      />
                      <Form.Check
                        type="switch"
                        id={`enabled-${plan.scope}`}
                        className="mb-3"
                        label="Sync enabled"
                        checked={target.enabled}
                        disabled={busy}
                        onChange={(e) =>
                          void saveTarget(plan.scope, { enabled: e.target.checked })
                        }
                      />

                      <div className="text-muted small mb-2">
                        Syncing to{" "}
                        {target.provider === "caldav" ? "CalDAV" : "Google Calendar"}.
                        Last synced: {formatTimestamp(target.lastSyncAt)}
                      </div>
                      {target.lastSyncError && (
                        <Alert variant="danger" className="small py-2">
                          Last sync error: {target.lastSyncError}
                        </Alert>
                      )}

                      <Button
                        variant="outline-secondary"
                        size="sm"
                        disabled={syncingScope === plan.scope || !target.enabled}
                        onClick={() => void syncNow(plan.scope)}
                      >
                        {syncingScope === plan.scope ? (
                          <Spinner animation="border" size="sm" />
                        ) : (
                          "Sync now"
                        )}
                      </Button>
                      <span className="text-muted small ms-2">
                        Re-pushes this week — use it if a background sync failed.
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </>
        )}

        <Modal
          show={showDisconnect !== null}
          onHide={() => setShowDisconnect(null)}
          centered
        >
          <Modal.Header closeButton>
            <Modal.Title>
              {showDisconnect === "caldav"
                ? "Disconnect CalDAV server?"
                : "Disconnect Google Calendar?"}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {showDisconnect === "caldav" ? (
              <p>
                This deletes your stored server address and password, and any
                sync target using them. Revoke the app password in your
                provider&apos;s own account settings as well.
              </p>
            ) : (
              <p>
                This removes your stored Google authorization and any sync
                target using it, and revokes the authorization at Google.
              </p>
            )}
            <p className="mb-0 text-muted small">
              Meals already added to that calendar are{" "}
              <strong>left in place</strong> — deleting them for you would be a
              surprising amount of destruction. Remove them yourself if you
              want them gone.
            </p>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowDisconnect(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={disconnecting}
              onClick={() => void handleDisconnect()}
            >
              {disconnecting ? <Spinner animation="border" size="sm" /> : "Disconnect"}
            </Button>
          </Modal.Footer>
        </Modal>
      </Card.Body>
    </Card>
  );
}
