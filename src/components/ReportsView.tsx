"use client";

import { useState } from "react";
import { Alert, Button, Col, Form, Nav, Row, Spinner, Table } from "react-bootstrap";

type Tab = "history" | "frequency" | "audit";

interface MealHistoryRow {
  date: string;
  mealType: string;
  scope: string;
  recipeName: string | null;
  plannedByName: string | null;
  ownerName: string | null;
}
interface RecipeFrequencyRow {
  recipeId: string;
  recipeName: string;
  scope: string;
  count: number;
}
interface AuditLogRow {
  id: string;
  timestamp: string;
  userName: string | null;
  action: string;
  scope: string | null;
  targetUserName: string | null;
  date: string | null;
  mealType: string | null;
  oldRecipeName: string | null;
  newRecipeName: string | null;
  notes: string | null;
}

const AUDIT_ACTIONS = [
  "spin_today",
  "spin_week",
  "manual_set",
  "manual_clear",
  "recipe_create",
  "recipe_update",
  "recipe_delete",
  "permission_change",
];

export default function ReportsView({
  isAdmin,
  householdUsers,
}: {
  isAdmin: boolean;
  householdUsers: { id: string; name: string }[];
}) {
  const [tab, setTab] = useState<Tab>("history");

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [scope, setScope] = useState("");
  const [mealType, setMealType] = useState("");
  const [userId, setUserId] = useState("");
  const [action, setAction] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyRows, setHistoryRows] = useState<MealHistoryRow[] | null>(null);
  const [frequencyRows, setFrequencyRows] = useState<RecipeFrequencyRow[] | null>(null);
  const [auditRows, setAuditRows] = useState<AuditLogRow[] | null>(null);

  function buildParams(extra?: Record<string, string>) {
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (tab !== "audit") {
      if (scope) params.set("scope", scope);
      if (mealType) params.set("mealType", mealType);
    } else if (action) {
      params.set("action", action);
    }
    if (isAdmin && userId) params.set("userId", userId);
    if (extra) {
      for (const [k, v] of Object.entries(extra)) params.set(k, v);
    }
    return params;
  }

  async function runReport() {
    setLoading(true);
    setError(null);
    try {
      const endpoint =
        tab === "history"
          ? "/api/reports/meal-history"
          : tab === "frequency"
          ? "/api/reports/recipe-frequency"
          : "/api/reports/audit-log";
      const res = await fetch(`${endpoint}?${buildParams().toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not load report.");
        return;
      }
      const data = await res.json();
      if (tab === "history") setHistoryRows(data);
      else if (tab === "frequency") setFrequencyRows(data);
      else setAuditRows(data);
    } finally {
      setLoading(false);
    }
  }

  function csvUrl() {
    const endpoint =
      tab === "history"
        ? "/api/reports/meal-history"
        : tab === "frequency"
        ? "/api/reports/recipe-frequency"
        : "/api/reports/audit-log";
    return `${endpoint}?${buildParams({ format: "csv" }).toString()}`;
  }

  return (
    <div>
      <Nav
        variant="tabs"
        activeKey={tab}
        className="mb-3"
        onSelect={(k) => setTab((k as Tab) ?? "history")}
      >
        <Nav.Item>
          <Nav.Link eventKey="history">Meal History</Nav.Link>
        </Nav.Item>
        <Nav.Item>
          <Nav.Link eventKey="frequency">Recipe Frequency</Nav.Link>
        </Nav.Item>
        <Nav.Item>
          <Nav.Link eventKey="audit">Audit Log</Nav.Link>
        </Nav.Item>
      </Nav>

      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Row className="g-2 align-items-end mb-3">
        <Col xs={6} md={2}>
          <Form.Label className="small">Start date</Form.Label>
          <Form.Control
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </Col>
        <Col xs={6} md={2}>
          <Form.Label className="small">End date</Form.Label>
          <Form.Control
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </Col>

        {tab !== "audit" && (
          <>
            <Col xs={6} md={2}>
              <Form.Label className="small">Scope</Form.Label>
              <Form.Select value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="">All</option>
                <option value="shared">Shared</option>
                <option value="private">Private</option>
              </Form.Select>
            </Col>
            <Col xs={6} md={2}>
              <Form.Label className="small">Meal type</Form.Label>
              <Form.Select value={mealType} onChange={(e) => setMealType(e.target.value)}>
                <option value="">All</option>
                <option value="breakfast">Breakfast</option>
                <option value="lunch">Lunch</option>
                <option value="dinner">Dinner</option>
              </Form.Select>
            </Col>
          </>
        )}

        {tab === "audit" && (
          <Col xs={6} md={3}>
            <Form.Label className="small">Action</Form.Label>
            <Form.Select value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">All</option>
              {AUDIT_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Form.Select>
          </Col>
        )}

        {isAdmin && (
          <Col xs={6} md={2}>
            <Form.Label className="small">User</Form.Label>
            <Form.Select value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">All</option>
              {householdUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Form.Select>
          </Col>
        )}

        <Col xs={12} md="auto" className="d-flex gap-2">
          <Button onClick={runReport} disabled={loading}>
            {loading ? <Spinner animation="border" size="sm" /> : "Run Report"}
          </Button>
          <Button variant="outline-secondary" href={csvUrl()} target="_blank">
            Export CSV
          </Button>
        </Col>
      </Row>

      {tab === "history" && historyRows && (
        <div className="table-responsive">
          <Table bordered hover size="sm">
            <thead>
              <tr>
                <th>Date</th>
                <th>Meal</th>
                <th>Scope</th>
                <th>Recipe</th>
                <th>Planned By</th>
                <th>Calendar Owner</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.map((r, i) => (
                <tr key={i}>
                  <td>{r.date}</td>
                  <td>{r.mealType}</td>
                  <td>{r.scope}</td>
                  <td>{r.recipeName}</td>
                  <td>{r.plannedByName}</td>
                  <td>{r.ownerName ?? "-"}</td>
                </tr>
              ))}
              {historyRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-muted text-center">
                    No results.
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </div>
      )}

      {tab === "frequency" && frequencyRows && (
        <div className="table-responsive">
          <Table bordered hover size="sm">
            <thead>
              <tr>
                <th>Recipe</th>
                <th>Scope</th>
                <th>Times Planned</th>
              </tr>
            </thead>
            <tbody>
              {frequencyRows.map((r) => (
                <tr key={r.recipeId}>
                  <td>{r.recipeName}</td>
                  <td>{r.scope}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
              {frequencyRows.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-muted text-center">
                    No results.
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </div>
      )}

      {tab === "audit" && auditRows && (
        <div className="table-responsive">
          <Table bordered hover size="sm">
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Action</th>
                <th>Scope</th>
                <th>Calendar Owner</th>
                <th>Date</th>
                <th>Meal</th>
                <th>Old Recipe</th>
                <th>New Recipe</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {auditRows.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.timestamp).toLocaleString()}</td>
                  <td>{r.userName}</td>
                  <td>{r.action}</td>
                  <td>{r.scope ?? "-"}</td>
                  <td>{r.targetUserName ?? "-"}</td>
                  <td>{r.date ?? "-"}</td>
                  <td>{r.mealType ?? "-"}</td>
                  <td>{r.oldRecipeName ?? "-"}</td>
                  <td>{r.newRecipeName ?? "-"}</td>
                  <td>{r.notes ?? "-"}</td>
                </tr>
              ))}
              {auditRows.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-muted text-center">
                    No results.
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
}
