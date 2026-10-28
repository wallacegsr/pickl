"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  ButtonGroup,
  Card,
  Form,
  Table,
  ToggleButton,
} from "react-bootstrap";
import type { MealType, Scope } from "@/db/schema";
// Download now goes through /api/shopping-list/export; only the clipboard
// path still formats in the browser.
import {
  buildShoppingListHtml,
  buildShoppingListText,
} from "@/lib/shoppingListExport";

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

export interface ShoppingListIngredientData {
  ingredientText: string;
  onHand: boolean;
}

export interface ShoppingListMealData {
  mealType: MealType;
  recipeId: string;
  recipeName: string;
  ingredients: ShoppingListIngredientData[];
}

export interface ShoppingListDayData {
  date: string;
  dayOfWeek: string;
  meals: ShoppingListMealData[];
}

/** Something added to the week's list by hand — or by Home Assistant. */
export interface ShoppingExtraData {
  id: string;
  text: string;
  onHand: boolean;
}

type ViewMode = "today" | "week";

export default function ShoppingListPanel({
  week,
  today,
  scope,
  requestedUserId,
  initialDays,
  initialExtras = [],
  bare = false,
}: {
  week: string;
  /** Today where the viewer is, from the server (see src/lib/viewerToday.ts). */
  today: string;
  scope: Scope;
  requestedUserId: string;
  initialDays: ShoppingListDayData[];
  /**
   * The week's extras, when the page has them to hand. Optional: the plan
   * dashboard's widget leaves it out and the fetch below fills them in.
   */
  initialExtras?: ShoppingExtraData[];
  /**
   * Drop the Card shell and the "🛒 Shopping List" title. Set when this panel
   * is rendered inside a dashboard widget, which supplies both already —
   * nesting a card in a card gave a doubled border and two competing
   * headings. Chrome only: every behaviour below is identical either way,
   * including the initialDays re-sync that keeps the list live after a shake.
   */
  bare?: boolean;
}) {
  const [days, setDays] = useState<ShoppingListDayData[]>(initialDays);
  const [extras, setExtras] = useState<ShoppingExtraData[]>(initialExtras);
  const [newExtra, setNewExtra] = useState("");
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<ViewMode>("today");
  const [error, setError] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<"txt" | "csv">("txt");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  // Re-sync from the server whenever it hands us a new list — both when the
  // identity of "what plan we're viewing" changes (Household <-> Private, a
  // different user's plan, a different week) and after a plan write.
  //
  // Depending on `initialDays` rather than only on those three is what keeps
  // this panel live: shaking the jar or editing a slot ends in a
  // `router.refresh()` in PlanView, which re-runs the server component and
  // rebuilds this list from the same `getWeekPlan` data the grid above uses.
  // Without it the list sat stale until a manual reload. `initialDays` is a
  // prop reference, so this only fires when the server actually re-rendered —
  // local state changes here (ticking an ingredient) don't retrigger it, and
  // it adds no fetch of its own.
  useEffect(() => {
    setDays(initialDays);
  }, [initialDays, scope, requestedUserId, week]);

  // And once more from the API on arrival. Next's client router can hand back
  // a cached render of a page visited earlier, whose ticks are from then — so
  // ticking something on /plan and returning to /shopping showed the old
  // state. The server's ticks are the truth; ask for them.
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ week, scope });
    if (scope === "private") params.set("userId", requestedUserId);
    fetch(`/api/shopping-list?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { days?: ShoppingListDayData[]; extras?: ShoppingExtraData[] } | null) => {
        if (cancelled) return;
        if (data?.days) setDays(data.days);
        // Extras can change from outside this page — Home Assistant adding
        // milk — so they come from here too, not only from the server render.
        if (data?.extras) setExtras(data.extras);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [scope, requestedUserId, week]);

  const todayDay = days.find((d) => d.date === today) ?? null;
  const visibleDays = mode === "today" ? (todayDay ? [todayDay] : []) : days;

  /**
   * Flips one ingredient line, identified by slot AND recipe.
   *
   * The recipe is part of the identity, not decoration: a dinner can hold a
   * main and a dessert, and two recipes sharing an ingredient would otherwise
   * tick each other off — on screen here, and in the database, which keys the
   * row the same way.
   */
  function applyOnHand(
    list: ShoppingListDayData[],
    date: string,
    mealType: MealType,
    recipeId: string,
    ingredientText: string,
    onHand: boolean
  ): ShoppingListDayData[] {
    return list.map((day) => {
      if (day.date !== date) return day;
      return {
        ...day,
        meals: day.meals.map((meal) => {
          if (meal.mealType !== mealType || meal.recipeId !== recipeId) return meal;
          return {
            ...meal,
            ingredients: meal.ingredients.map((ing) =>
              ing.ingredientText === ingredientText ? { ...ing, onHand } : ing
            ),
          };
        }),
      };
    });
  }

  async function toggleIngredient(
    date: string,
    mealType: MealType,
    recipeId: string,
    ingredientText: string,
    nextOnHand: boolean
  ) {
    setError(null);
    // Optimistic update.
    setDays((prev) =>
      applyOnHand(prev, date, mealType, recipeId, ingredientText, nextOnHand)
    );

    const res = await fetch("/api/shopping-list", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date,
        mealType,
        recipeId,
        ingredientText,
        onHand: nextOnHand,
        scope,
        userId: scope === "private" ? requestedUserId : undefined,
      }),
    });

    if (!res.ok) {
      // Revert on failure.
      setDays((prev) =>
        applyOnHand(prev, date, mealType, recipeId, ingredientText, !nextOnHand)
      );
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not update this item.");
    }
  }

  /** `?scope=&userId=` naming this list's calendar, for the extras routes. */
  function calendarQuery() {
    const params = new URLSearchParams({ scope });
    if (scope === "private") params.set("userId", requestedUserId);
    return params.toString();
  }

  async function addExtraItem(e: React.FormEvent) {
    e.preventDefault();
    const text = newExtra.trim();
    if (!text) return;
    setError(null);
    setAdding(true);
    const res = await fetch("/api/shopping-list/extras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        week,
        text,
        scope,
        userId: scope === "private" ? requestedUserId : undefined,
      }),
    });
    setAdding(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Could not add that.");
      return;
    }
    setExtras((prev) => [...prev, data as ShoppingExtraData]);
    setNewExtra("");
  }

  async function toggleExtra(id: string, onHand: boolean) {
    setError(null);
    const flip = (value: boolean) =>
      setExtras((prev) => prev.map((x) => (x.id === id ? { ...x, onHand: value } : x)));
    flip(onHand);
    const res = await fetch(`/api/shopping-list/extras/${encodeURIComponent(id)}?${calendarQuery()}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onHand }),
    });
    if (!res.ok) {
      flip(!onHand);
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not update this item.");
    }
  }

  async function removeExtra(id: string) {
    setError(null);
    const res = await fetch(`/api/shopping-list/extras/${encodeURIComponent(id)}?${calendarQuery()}`, {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 404) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not remove this item.");
      return;
    }
    setExtras((prev) => prev.filter((x) => x.id !== id));
  }

  function handleDownload() {
    // Navigating to a route that answers with Content-Disposition, rather than
    // building a Blob here. A `blob:` URL never reaches an Android WebView's
    // DownloadListener, so the in-browser version of this button silently did
    // nothing inside the mobile shell. The server route shares the same
    // builders, so the file is byte-identical either way.
    const params = new URLSearchParams({ week, mode, format: exportFormat, scope });
    if (scope === "private" && requestedUserId) {
      params.set("userId", requestedUserId);
    }
    window.location.href = `/api/shopping-list/export?${params.toString()}`;
  }

  async function handleCopy() {
    const text = buildShoppingListText(visibleDays, extras);
    const html = buildShoppingListHtml(visibleDays, extras);
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([text], { type: "text/plain" }),
            "text/html": new Blob([html], { type: "text/html" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
    setTimeout(() => setCopyStatus("idle"), 2500);
  }

  function renderMealTable(day: ShoppingListDayData, meal: ShoppingListMealData) {
    return (
      // Keyed by recipe too: a slot can hold two, and keying on the meal
      // alone gave React duplicate keys for the same dinner.
      <div key={`${day.date}-${meal.mealType}-${meal.recipeId}`} className="mb-3">
        <div className="fw-semibold mb-1">
          {MEAL_LABELS[meal.mealType]} — {meal.recipeName}
        </div>
        {/* Ingredients are optional on a recipe, so a planned meal can have
            none. Say so rather than rendering an empty bordered table. */}
        {meal.ingredients.length === 0 ? (
          <p className="text-body-secondary small fst-italic mb-0">
            No ingredients listed for this one.
          </p>
        ) : (
        <div className="table-responsive">
          <Table size="sm" bordered className="mb-0 align-middle">
            <tbody>
              {meal.ingredients.map((ing) => (
                <tr key={ing.ingredientText}>
                  <td style={{ width: 32 }}>
                    <Form.Check
                      type="checkbox"
                      checked={ing.onHand}
                      onChange={(e) =>
                        toggleIngredient(
                          day.date,
                          meal.mealType,
                          meal.recipeId,
                          ing.ingredientText,
                          e.target.checked
                        )
                      }
                      aria-label={ing.onHand ? "Mark as need to buy" : "Mark as on hand"}
                    />
                  </td>
                  <td
                    className={ing.onHand ? "text-muted text-decoration-line-through" : undefined}
                  >
                    {ing.ingredientText}
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

  const body = (
    <>
        <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
          {!bare && <Card.Title className="mb-0">🛒 Shopping List</Card.Title>}
          <ButtonGroup>
            <ToggleButton
              id="shopping-mode-today"
              type="radio"
              variant="outline-secondary"
              size="sm"
              name="shopping-mode"
              value="today"
              checked={mode === "today"}
              onChange={() => setMode("today")}
            >
              Today
            </ToggleButton>
            <ToggleButton
              id="shopping-mode-week"
              type="radio"
              variant="outline-secondary"
              size="sm"
              name="shopping-mode"
              value="week"
              checked={mode === "week"}
              onChange={() => setMode("week")}
            >
              Full Week
            </ToggleButton>
          </ButtonGroup>
        </div>

        <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
          <Form.Select
            size="sm"
            style={{ width: "auto" }}
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value as "txt" | "csv")}
            aria-label="Export file format"
          >
            <option value="txt">Text (.txt)</option>
            <option value="csv">CSV (.csv)</option>
          </Form.Select>
          <Button
            size="sm"
            variant="outline-secondary"
            onClick={handleDownload}
            disabled={visibleDays.length === 0 && extras.length === 0}
          >
            ⬇️ Download
          </Button>
          <Button
            size="sm"
            variant="outline-secondary"
            onClick={handleCopy}
            disabled={visibleDays.length === 0 && extras.length === 0}
          >
            📋 Copy
          </Button>
          {copyStatus === "copied" && (
            <span className="text-success small">Copied to clipboard!</span>
          )}
          {copyStatus === "failed" && (
            <span className="text-danger small">
              Could not copy — your browser may block clipboard access here.
            </span>
          )}
        </div>

        {error && (
          <Alert variant="danger" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {visibleDays.length === 0 && (
          <p className="text-muted fst-italic mb-0">
            {mode === "today"
              ? "Nothing planned today — the jar's still shut."
              : "Nothing planned this week — the jar's still shut."}
          </p>
        )}

        {visibleDays.map((day) => (
          <div key={day.date} className="mb-4">
            {mode === "week" && (
              <h6 className="border-bottom pb-1 mb-2">
                {day.dayOfWeek} <span className="text-muted small">({day.date})</span>
              </h6>
            )}
            {day.meals.map((meal) => renderMealTable(day, meal))}
          </div>
        ))}

        {/* Extras belong to the week, not a day, so they show in both views:
            on today's trip to the shop they are still what you went for. */}
        <section aria-labelledby="shopping-extras-heading" className="mt-3">
          <h6 id="shopping-extras-heading" className="border-bottom pb-1 mb-2">
            Extras
          </h6>
          {extras.length > 0 && (
            <div className="table-responsive mb-2">
              <Table size="sm" bordered className="mb-0 align-middle">
                <tbody>
                  {extras.map((extra) => (
                    <tr key={extra.id}>
                      <td style={{ width: 32 }}>
                        <Form.Check
                          type="checkbox"
                          checked={extra.onHand}
                          onChange={(e) => toggleExtra(extra.id, e.target.checked)}
                          aria-label={extra.onHand ? `Mark ${extra.text} as need to buy` : `Mark ${extra.text} as on hand`}
                        />
                      </td>
                      <td className={extra.onHand ? "text-muted text-decoration-line-through" : undefined}>
                        {extra.text}
                      </td>
                      <td style={{ width: 40 }} className="text-end">
                        <Button
                          size="sm"
                          variant="link"
                          className="text-body-secondary p-0 px-1 text-decoration-none"
                          onClick={() => removeExtra(extra.id)}
                          aria-label={`Remove ${extra.text}`}
                          title="Remove"
                        >
                          ✕
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
          <Form onSubmit={addExtraItem} className="d-flex gap-2" style={{ maxWidth: "28rem" }}>
            <Form.Control
              size="sm"
              value={newExtra}
              onChange={(e) => setNewExtra(e.target.value)}
              placeholder="Add something — milk, bin bags…"
              aria-label="Add an item to this week's list"
              maxLength={200}
            />
            <Button type="submit" size="sm" variant="outline-secondary" disabled={adding || !newExtra.trim()}>
              Add
            </Button>
          </Form>
        </section>
    </>
  );

  if (bare) return body;

  return (
    <Card className="mt-4">
      <Card.Body>{body}</Card.Body>
    </Card>
  );
}
