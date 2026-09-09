"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Alert, Button, Col, Form, Nav, Row, Spinner } from "react-bootstrap";
import {
  StackedBody,
  StackedCell,
  StackedEmpty,
  StackedHead,
  StackedHeader,
  StackedRow,
  StackedTable,
} from "@/components/reports/StackedTable";

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

  /**
   * Local midnight of a YYYY-MM-DD, in epoch milliseconds, optionally N days
   * later. Built from the parts rather than `new Date(string)`, which parses
   * a bare date as UTC and would reintroduce the very offset this avoids.
   */
  function localDayStart(date: string, plusDays = 0) {
    const [year, month, day] = date.split("-").map(Number);
    return new Date(year, month - 1, day + plusDays).getTime();
  }

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
      // The audit log is a list of moments, so "8 September" has to mean this
      // viewer's 8 September. Only the browser knows that, so it resolves the
      // picked dates to instants here rather than letting the server guess
      // with its own clock — which in a container is UTC, and cut the day off
      // at 5pm for anyone in California.
      if (startDate) params.set("startAt", String(localDayStart(startDate)));
      if (endDate) params.set("endBefore", String(localDayStart(endDate, 1)));
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
        <StackedTable hover>
          <StackedHead>
            <StackedRow>
              <StackedHeader>{grouping === "week" ? "Week of" : "Month"}</StackedHeader>
              <StackedHeader>Meals</StackedHeader>
              <StackedHeader title="How many different recipes appeared — the variety behind the count">
                Distinct Recipes
              </StackedHeader>
              <StackedHeader>Breakfast</StackedHeader>
              <StackedHeader>Lunch</StackedHeader>
              <StackedHeader>Dinner</StackedHeader>
            </StackedRow>
          </StackedHead>
          <StackedBody>
            {groupedHistory(historyRows, grouping).map((g) => (
              <StackedRow key={g.key}>
                <StackedCell label={grouping === "week" ? "Week of" : "Month"}>{g.key}</StackedCell>
                <StackedCell label="Meals">{g.meals}</StackedCell>
                <StackedCell label="Distinct recipes">{g.distinctRecipes}</StackedCell>
                <StackedCell label="Breakfast">{g.breakfast}</StackedCell>
                <StackedCell label="Lunch">{g.lunch}</StackedCell>
                <StackedCell label="Dinner">{g.dinner}</StackedCell>
              </StackedRow>
            ))}
            {historyRows.length === 0 && <StackedEmpty colSpan={6}>No results.</StackedEmpty>}
          </StackedBody>
        </StackedTable>
      )}

      {tab === "history" && historyRows && grouping === "flat" && (
        <StackedTable hover>
          <StackedHead>
            <StackedRow>
              <StackedHeader>Date</StackedHeader>
              <StackedHeader>Meal</StackedHeader>
              <StackedHeader>Scope</StackedHeader>
              <StackedHeader>Recipe</StackedHeader>
              <StackedHeader>Tags</StackedHeader>
              <StackedHeader>Planned By</StackedHeader>
              <StackedHeader>Calendar Owner</StackedHeader>
            </StackedRow>
          </StackedHead>
          <StackedBody>
            {historyRows.map((r, i) => (
              <StackedRow key={i}>
                <StackedCell label="Date">{r.date}</StackedCell>
                <StackedCell label="Meal">{r.mealType}</StackedCell>
                <StackedCell label="Scope">{r.scope}</StackedCell>
                <StackedCell label="Recipe">{r.recipeName}</StackedCell>
                <StackedCell label="Tags">{r.tags.length > 0 ? r.tags.join(", ") : "-"}</StackedCell>
                <StackedCell label="Planned by">{r.plannedByName}</StackedCell>
                <StackedCell label="Calendar owner">{r.ownerName ?? "-"}</StackedCell>
              </StackedRow>
            ))}
            {historyRows.length === 0 && <StackedEmpty colSpan={7}>No results.</StackedEmpty>}
          </StackedBody>
        </StackedTable>
      )}

      {tab === "frequency" && frequencyRows && frequencyRows.length > 0 && (
        <RecipeFrequencyChart rows={frequencyRows} />
      )}

      {tab === "frequency" && frequencyRows && (
        <StackedTable hover>
          <StackedHead>
            <StackedRow>
              <StackedHeader>Recipe</StackedHeader>
              <StackedHeader>Scope</StackedHeader>
              <StackedHeader>Times Planned</StackedHeader>
              <StackedHeader title="Times per 30 days across the reported span, so two different ranges can be compared">
                Per Month
              </StackedHeader>
              <StackedHeader>Last Planned</StackedHeader>
              <StackedHeader>Days Since</StackedHeader>
            </StackedRow>
          </StackedHead>
          <StackedBody>
            {frequencyRows.map((r) => (
              <StackedRow
                key={r.recipeId}
                className={r.count === 0 ? "text-body-secondary" : undefined}
              >
                <StackedCell label="Recipe">{r.recipeName}</StackedCell>
                <StackedCell label="Scope">{r.scope}</StackedCell>
                <StackedCell label="Times planned">{r.count}</StackedCell>
                {/* A dash rather than 0.0 when the span is too short to
                    extrapolate from — a made-up rate is worse than none. */}
                <StackedCell label="Per month">
                  {r.perMonth === null ? "—" : r.perMonth.toFixed(1)}
                </StackedCell>
                <StackedCell label="Last planned">{r.lastPlanned ?? <em>Never</em>}</StackedCell>
                <StackedCell label="Days since">
                  {r.daysSince === null ? "—" : r.daysSince}
                </StackedCell>
              </StackedRow>
            ))}
            {frequencyRows.length === 0 && <StackedEmpty colSpan={6}>No results.</StackedEmpty>}
          </StackedBody>
        </StackedTable>
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
              <StackedTable>
                <StackedHead>
                  <StackedRow>
                    <StackedHeader>Meal</StackedHeader>
                    <StackedHeader>Planned</StackedHeader>
                    <StackedHeader>Of</StackedHeader>
                    <StackedHeader>Share</StackedHeader>
                  </StackedRow>
                </StackedHead>
                <StackedBody>
                  {patterns.coverage.map((c) => (
                    <StackedRow key={c.mealType}>
                      <StackedCell label="Meal">{c.mealType}</StackedCell>
                      <StackedCell label="Planned">{c.planned}</StackedCell>
                      <StackedCell label="Of">{c.possible}</StackedCell>
                      <StackedCell label="Share">{c.percent}%</StackedCell>
                    </StackedRow>
                  ))}
                </StackedBody>
              </StackedTable>
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
              <StackedTable>
                <StackedHead>
                  <StackedRow>
                    <StackedHeader>Who</StackedHeader>
                    <StackedHeader>Meals</StackedHeader>
                    <StackedHeader>Share</StackedHeader>
                  </StackedRow>
                </StackedHead>
                <StackedBody>
                  {patterns.planners.map((p) => (
                    <StackedRow key={p.userName}>
                      <StackedCell label="Who">{p.userName}</StackedCell>
                      <StackedCell label="Meals">{p.count}</StackedCell>
                      <StackedCell label="Share">{p.percent}%</StackedCell>
                    </StackedRow>
                  ))}
                  {patterns.planners.length === 0 && (
                    <StackedEmpty colSpan={3}>Nothing planned in this range.</StackedEmpty>
                  )}
                </StackedBody>
              </StackedTable>
            </Col>

            <Col md={6}>
              <h3 className="h6">Cook time by day</h3>
              <p className="text-body-secondary small mb-2">
                Average prep + cook minutes. Only recipes that state a time can
                count, so the last column says how many did.
              </p>
              <StackedTable>
                <StackedHead>
                  <StackedRow>
                    <StackedHeader>Day</StackedHeader>
                    <StackedHeader>Meals</StackedHeader>
                    <StackedHeader>Avg minutes</StackedHeader>
                    <StackedHeader title="How many of those meals stated a prep or cook time">
                      With times
                    </StackedHeader>
                  </StackedRow>
                </StackedHead>
                <StackedBody>
                  {patterns.weekdays.map((w) => (
                    <StackedRow key={w.weekday}>
                      <StackedCell label="Day">{w.weekdayName}</StackedCell>
                      <StackedCell label="Meals">{w.meals}</StackedCell>
                      {/* Dash, not 0: an average of no measurements is not
                          zero minutes. */}
                      <StackedCell label="Avg minutes">
                        {w.averageMinutes === null ? "—" : w.averageMinutes}
                      </StackedCell>
                      <StackedCell label="With times">{w.withTimes}</StackedCell>
                    </StackedRow>
                  ))}
                </StackedBody>
              </StackedTable>
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
              <StackedTable>
                <StackedHead>
                  <StackedRow>
                    <StackedHeader>Tag</StackedHeader>
                    <StackedHeader>Meals</StackedHeader>
                    <StackedHeader>Share</StackedHeader>
                  </StackedRow>
                </StackedHead>
                <StackedBody>
                  {patterns.tagMix.map((t) => (
                    <StackedRow key={t.tag}>
                      <StackedCell label="Tag">{t.tag}</StackedCell>
                      <StackedCell label="Meals">{t.count}</StackedCell>
                      <StackedCell label="Share">{t.percent}%</StackedCell>
                    </StackedRow>
                  ))}
                  {patterns.tagMix.length === 0 && (
                    <StackedEmpty colSpan={3}>No tagged meals in this range.</StackedEmpty>
                  )}
                </StackedBody>
              </StackedTable>
            </Col>
          </Row>
        </div>
      )}

      {tab === "audit" && auditRows && (
        <StackedTable hover>
          <StackedHead>
            <StackedRow>
              <StackedHeader>When</StackedHeader>
              <StackedHeader>User</StackedHeader>
              <StackedHeader>Action</StackedHeader>
              <StackedHeader>Scope</StackedHeader>
              <StackedHeader>Calendar Owner</StackedHeader>
              <StackedHeader>Date</StackedHeader>
              <StackedHeader>Meal</StackedHeader>
              <StackedHeader>Old Recipe</StackedHeader>
              <StackedHeader>New Recipe</StackedHeader>
              <StackedHeader>Notes</StackedHeader>
            </StackedRow>
          </StackedHead>
          <StackedBody>
            {auditRows.map((r) => (
              <StackedRow key={r.id}>
                <StackedCell label="When" suppressHydrationWarning>
                  {new Date(r.timestamp).toLocaleString()}
                </StackedCell>
                <StackedCell label="User">{r.userName}</StackedCell>
                <StackedCell label="Action">{r.action}</StackedCell>
                <StackedCell label="Scope">{r.scope ?? "-"}</StackedCell>
                <StackedCell label="Calendar owner">{r.targetUserName ?? "-"}</StackedCell>
                <StackedCell label="Date">{r.date ?? "-"}</StackedCell>
                <StackedCell label="Meal">{r.mealType ?? "-"}</StackedCell>
                <StackedCell label="Old recipe">{r.oldRecipeName ?? "-"}</StackedCell>
                <StackedCell label="New recipe">{r.newRecipeName ?? "-"}</StackedCell>
                <StackedCell label="Notes">{r.notes ?? "-"}</StackedCell>
              </StackedRow>
            ))}
            {auditRows.length === 0 && <StackedEmpty colSpan={10}>No results.</StackedEmpty>}
          </StackedBody>
        </StackedTable>
      )}
    </div>
  );
}
