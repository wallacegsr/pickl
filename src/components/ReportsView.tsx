"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Alert, Button, Col, Form, Nav, Row, Spinner, Table } from "react-bootstrap";

// Client-only, like the dashboard grid: Chart.js measures and paints a canvas,
// so there is nothing for the server to render and no point shipping it into
// the server bundle. Charts are display-only — the CSV export below is built
// from the same rows and is unaffected by any of this.
const MealTypeChart = dynamic(
  () => import("./reports/ReportCharts").then((m) => m.MealTypeChart),
  { ssr: false }
);
const MealsOverTimeChart = dynamic(
  () => import("./reports/ReportCharts").then((m) => m.MealsOverTimeChart),
  { ssr: false }
);
const RecipeFrequencyChart = dynamic(
  () => import("./reports/ReportCharts").then((m) => m.RecipeFrequencyChart),
  { ssr: false }
);

type Tab = "history" | "frequency" | "patterns" | "audit";

interface MealHistoryRow {
  date: string;
  mealType: string;
  scope: string;
  recipeName: string | null;
  plannedByName: string | null;
  ownerName: string | null;
  tags: string[];
}
interface RecipeFrequencyRow {
  recipeId: string;
  recipeName: string;
  scope: string;
  count: number;
  lastPlanned: string | null;
  daysSince: number | null;
  perMonth: number | null;
}

interface PatternsReport {
  spanStart: string | null;
  spanEnd: string | null;
  spanDays: number;
  totalMeals: number;
  coverage: { mealType: string; planned: number; possible: number; percent: number }[];
  weekdays: {
    weekday: number;
    weekdayName: string;
    meals: number;
    averageMinutes: number | null;
    withTimes: number;
  }[];
  tagMix: { tag: string; count: number; percent: number }[];
  untaggedMeals: number;
  dessertMeals: number;
  dessertsPerWeek: number | null;
  planners: { userName: string; count: number; percent: number }[];
}

/** How Meal History groups its rows. */
type Grouping = "flat" | "week" | "month";
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
  allTags = [],
}: {
  isAdmin: boolean;
  householdUsers: { id: string; name: string }[];
  /** Tag names this user may see, for the tag filter. */
  allTags?: string[];
}) {
  const [tab, setTab] = useState<Tab>("history");

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [scope, setScope] = useState("");
  const [mealType, setMealType] = useState("");
  const [userId, setUserId] = useState("");
  const [action, setAction] = useState("");
  const [tag, setTag] = useState("");
  const [planChangesOnly, setPlanChangesOnly] = useState(false);
  const [grouping, setGrouping] = useState<Grouping>("flat");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyRows, setHistoryRows] = useState<MealHistoryRow[] | null>(null);
  const [frequencyRows, setFrequencyRows] = useState<RecipeFrequencyRow[] | null>(null);
  const [auditRows, setAuditRows] = useState<AuditLogRow[] | null>(null);
  const [patterns, setPatterns] = useState<PatternsReport | null>(null);

  function buildParams(extra?: Record<string, string>) {
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (tab !== "audit") {
      if (scope) params.set("scope", scope);
      if (mealType) params.set("mealType", mealType);
      if (tag) params.set("tag", tag);
    } else {
      if (action) params.set("action", action);
      if (planChangesOnly) params.set("planChangesOnly", "1");
    }
    if (isAdmin && userId) params.set("userId", userId);
    if (extra) {
      for (const [k, v] of Object.entries(extra)) params.set(k, v);
    }
    return params;
  }

  const ENDPOINTS: Record<Tab, string> = {
    history: "/api/reports/meal-history",
    frequency: "/api/reports/recipe-frequency",
    patterns: "/api/reports/patterns",
    audit: "/api/reports/audit-log",
  };

  async function runReport() {
    setLoading(true);
    setError(null);
    try {
      const endpoint = ENDPOINTS[tab];
      const res = await fetch(`${endpoint}?${buildParams().toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not load report.");
        return;
      }
      const data = await res.json();
      if (tab === "history") setHistoryRows(data);
      else if (tab === "frequency") setFrequencyRows(data);
      else if (tab === "patterns") setPatterns(data);
      else setAuditRows(data);
    } finally {
      setLoading(false);
    }
  }

  function csvUrl() {
    return `${ENDPOINTS[tab]}?${buildParams({ format: "csv" }).toString()}`;
  }

  /**
   * Meal History collapsed to one row per week or month.
   *
   * The flat list is a log; at a month's range it is 90 rows nobody reads.
   * The summary answers the question the log only implies — how much was
   * planned, how varied was it — and month grouping doubles as the seasonal
   * view, which is why there is no separate report for that.
   */
  function groupedHistory(rows: MealHistoryRow[], by: Exclude<Grouping, "flat">) {
    const buckets = new Map<
      string,
      { meals: number; recipes: Set<string>; byMeal: Map<string, number> }
    >();
    for (const row of rows) {
      const key =
        by === "month"
          ? row.date.slice(0, 7)
          : // Weeks start Sunday, matching the plan grid rather than inventing
            // a second week convention.
            (() => {
              const d = new Date(row.date + "T00:00:00");
              d.setDate(d.getDate() - d.getDay());
              return d.toISOString().slice(0, 10);
            })();
      const bucket = buckets.get(key) ?? {
        meals: 0,
        recipes: new Set<string>(),
        byMeal: new Map<string, number>(),
      };
      bucket.meals += 1;
      if (row.recipeName) bucket.recipes.add(row.recipeName);
      bucket.byMeal.set(row.mealType, (bucket.byMeal.get(row.mealType) ?? 0) + 1);
      buckets.set(key, bucket);
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, b]) => ({
        key,
        meals: b.meals,
        distinctRecipes: b.recipes.size,
        breakfast: b.byMeal.get("breakfast") ?? 0,
        lunch: b.byMeal.get("lunch") ?? 0,
        dinner: b.byMeal.get("dinner") ?? 0,
      }));
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
          <Nav.Link eventKey="patterns">Patterns</Nav.Link>
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
            <Col xs={6} md={2}>
              <Form.Label className="small">Tag</Form.Label>
              <Form.Select value={tag} onChange={(e) => setTag(e.target.value)}>
                <option value="">All</option>
                {allTags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Form.Select>
            </Col>
          </>
        )}

        {tab === "history" && (
          <Col xs={6} md={2}>
            <Form.Label className="small">Group by</Form.Label>
            <Form.Select
              value={grouping}
              onChange={(e) => setGrouping(e.target.value as Grouping)}
            >
              <option value="flat">Every meal</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </Form.Select>
          </Col>
        )}

        {tab === "audit" && (
          <Col xs={6} md={2} className="pb-2">
            <Form.Check
              type="checkbox"
              id="plan-changes-only"
              label="Plan changes only"
              checked={planChangesOnly}
              onChange={(e) => setPlanChangesOnly(e.target.checked)}
              // Tag admin, recipe edits and theme changes bury the answer when
              // the question is "who moved dinner?".
              title="Hide tag, recipe and preference changes"
            />
          </Col>
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
          {/* Patterns has no CSV: it is five different shapes at once, and
              flattening them into one file would produce something unusable. */}
          {tab !== "patterns" && (
          <Button variant="outline-secondary" href={csvUrl()} target="_blank">
            Export CSV
          </Button>
          )}
        </Col>
      </Row>

      {tab === "history" && historyRows && historyRows.length > 0 && (
        <>
          {/* What the mix is, then whether it is changing. */}
          <MealTypeChart rows={historyRows} />
          <MealsOverTimeChart rows={historyRows} />
        </>
      )}

      {tab === "history" && historyRows && grouping !== "flat" && (
        <div className="table-responsive">
          <Table bordered hover size="sm">
            <thead>
              <tr>
                <th>{grouping === "week" ? "Week of" : "Month"}</th>
                <th>Meals</th>
                <th title="How many different recipes appeared — the variety behind the count">
                  Distinct Recipes
                </th>
                <th>Breakfast</th>
                <th>Lunch</th>
                <th>Dinner</th>
              </tr>
            </thead>
            <tbody>
              {groupedHistory(historyRows, grouping).map((g) => (
                <tr key={g.key}>
                  <td>{g.key}</td>
                  <td>{g.meals}</td>
                  <td>{g.distinctRecipes}</td>
                  <td>{g.breakfast}</td>
                  <td>{g.lunch}</td>
                  <td>{g.dinner}</td>
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

      {tab === "history" && historyRows && grouping === "flat" && (
        <div className="table-responsive">
          <Table bordered hover size="sm">
            <thead>
              <tr>
                <th>Date</th>
                <th>Meal</th>
                <th>Scope</th>
                <th>Recipe</th>
                <th>Tags</th>
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
                  <td>{r.tags.length > 0 ? r.tags.join(", ") : "-"}</td>
                  <td>{r.plannedByName}</td>
                  <td>{r.ownerName ?? "-"}</td>
                </tr>
              ))}
              {historyRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-muted text-center">
                    No results.
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </div>
      )}

      {tab === "frequency" && frequencyRows && frequencyRows.length > 0 && (
        <RecipeFrequencyChart rows={frequencyRows} />
      )}

      {tab === "frequency" && frequencyRows && (
        <div className="table-responsive">
          <Table bordered hover size="sm">
            <thead>
              <tr>
                <th>Recipe</th>
                <th>Scope</th>
                <th>Times Planned</th>
                <th title="Times per 30 days across the reported span, so two different ranges can be compared">
                  Per Month
                </th>
                <th>Last Planned</th>
                <th>Days Since</th>
              </tr>
            </thead>
            <tbody>
              {frequencyRows.map((r) => (
                <tr key={r.recipeId} className={r.count === 0 ? "text-body-secondary" : undefined}>
                  <td>{r.recipeName}</td>
                  <td>{r.scope}</td>
                  <td>{r.count}</td>
                  {/* A dash rather than 0.0 when the span is too short to
                      extrapolate from — a made-up rate is worse than none. */}
                  <td>{r.perMonth === null ? "—" : r.perMonth.toFixed(1)}</td>
                  <td>{r.lastPlanned ?? <em>Never</em>}</td>
                  <td>{r.daysSince === null ? "—" : r.daysSince}</td>
                </tr>
              ))}
              {frequencyRows.length === 0 && (
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

      {tab === "patterns" && patterns && (
        <div>
          <p className="text-body-secondary small">
            {patterns.totalMeals} planned {patterns.totalMeals === 1 ? "meal" : "meals"}
            {patterns.spanStart && patterns.spanEnd
              ? ` from ${patterns.spanStart} to ${patterns.spanEnd} (${patterns.spanDays} days)`
              : ""}
            .
          </p>

          <Row className="g-3">
            <Col md={6}>
              <h3 className="h6">Planning coverage</h3>
              <p className="text-body-secondary small mb-2">
                How often each meal actually gets planned. Counted per day, so a
                dinner holding two recipes is still one dinner.
              </p>
              <Table bordered size="sm">
                <thead>
                  <tr>
                    <th>Meal</th>
                    <th>Planned</th>
                    <th>Of</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {patterns.coverage.map((c) => (
                    <tr key={c.mealType}>
                      <td>{c.mealType}</td>
                      <td>{c.planned}</td>
                      <td>{c.possible}</td>
                      <td>{c.percent}%</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Col>

            <Col md={6}>
              <h3 className="h6">Desserts</h3>
              <p className="text-body-secondary small mb-2">
                Meals whose recipe is tagged as a dessert.
              </p>
              <p className="mb-4">
                <strong>{patterns.dessertMeals}</strong> in this range
                {patterns.dessertsPerWeek !== null && (
                  <> — about <strong>{patterns.dessertsPerWeek}</strong> a week</>
                )}
                .
              </p>

              <h3 className="h6">Who plans</h3>
              <Table bordered size="sm">
                <thead>
                  <tr>
                    <th>Who</th>
                    <th>Meals</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {patterns.planners.map((p) => (
                    <tr key={p.userName}>
                      <td>{p.userName}</td>
                      <td>{p.count}</td>
                      <td>{p.percent}%</td>
                    </tr>
                  ))}
                  {patterns.planners.length === 0 && (
                    <tr>
                      <td colSpan={3} className="text-muted text-center">
                        Nothing planned in this range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </Col>

            <Col md={6}>
              <h3 className="h6">Cook time by day</h3>
              <p className="text-body-secondary small mb-2">
                Average prep + cook minutes. Only recipes that state a time can
                count, so the last column says how many did.
              </p>
              <Table bordered size="sm">
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Meals</th>
                    <th>Avg minutes</th>
                    <th title="How many of those meals stated a prep or cook time">
                      With times
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {patterns.weekdays.map((w) => (
                    <tr key={w.weekday}>
                      <td>{w.weekdayName}</td>
                      <td>{w.meals}</td>
                      {/* Dash, not 0: an average of no measurements is not
                          zero minutes. */}
                      <td>{w.averageMinutes === null ? "—" : w.averageMinutes}</td>
                      <td>{w.withTimes}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Col>

            <Col md={6}>
              <h3 className="h6">Tag mix</h3>
              <p className="text-body-secondary small mb-2">
                Share of planned meals carrying each tag. A meal with several
                tags counts under each, so these do not add up to 100%.
                {patterns.untaggedMeals > 0 && (
                  <> {patterns.untaggedMeals} planned {patterns.untaggedMeals === 1 ? "meal has" : "meals have"} no tags at all.</>
                )}
              </p>
              <Table bordered size="sm">
                <thead>
                  <tr>
                    <th>Tag</th>
                    <th>Meals</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {patterns.tagMix.map((t) => (
                    <tr key={t.tag}>
                      <td>{t.tag}</td>
                      <td>{t.count}</td>
                      <td>{t.percent}%</td>
                    </tr>
                  ))}
                  {patterns.tagMix.length === 0 && (
                    <tr>
                      <td colSpan={3} className="text-muted text-center">
                        No tagged meals in this range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </Col>
          </Row>
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
                  <td suppressHydrationWarning>{new Date(r.timestamp).toLocaleString()}</td>
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
