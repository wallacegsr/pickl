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
import { todayDateString } from "@/lib/dates";
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

type ViewMode = "today" | "week";

export default function ShoppingListPanel({
  week,
  scope,
  requestedUserId,
  initialDays,
  bare = false,
}: {
  week: string;
  scope: Scope;
  requestedUserId: string;
  initialDays: ShoppingListDayData[];
  /**
   * Drop the Card shell and the "🛒 Shopping List" title. Set when this panel
   * is rendered inside a dashboard widget, which supplies both already —
   * nesting a card in a card gave a doubled border and two competing
   * headings. Chrome only: every behaviour below is identical either way,
   * including the initialDays re-sync that keeps the list live after a shake.
   */
  bare?: boolean;
}) {
  const today = todayDateString();
  const [days, setDays] = useState<ShoppingListDayData[]>(initialDays);
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

  const todayDay = days.find((d) => d.date === today) ?? null;
  const visibleDays = mode === "today" ? (todayDay ? [todayDay] : []) : days;

  async function toggleIngredient(
    date: string,
    mealType: MealType,
    ingredientText: string,
    nextOnHand: boolean
  ) {
    setError(null);
    // Optimistic update.
    setDays((prev) =>
      prev.map((day) => {
        if (day.date !== date) return day;
        return {
          ...day,
          meals: day.meals.map((meal) => {
            if (meal.mealType !== mealType) return meal;
            return {
              ...meal,
              ingredients: meal.ingredients.map((ing) =>
                ing.ingredientText === ingredientText ? { ...ing, onHand: nextOnHand } : ing
              ),
            };
          }),
        };
      })
    );

    const res = await fetch("/api/shopping-list", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date,
        mealType,
        ingredientText,
        onHand: nextOnHand,
        scope,
        userId: scope === "private" ? requestedUserId : undefined,
      }),
    });

    if (!res.ok) {
      // Revert on failure.
      setDays((prev) =>
        prev.map((day) => {
          if (day.date !== date) return day;
          return {
            ...day,
            meals: day.meals.map((meal) => {
              if (meal.mealType !== mealType) return meal;
              return {
                ...meal,
                ingredients: meal.ingredients.map((ing) =>
                  ing.ingredientText === ingredientText
                    ? { ...ing, onHand: !nextOnHand }
                    : ing
                ),
              };
            }),
          };
        })
      );
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not update this item.");
    }
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
    const text = buildShoppingListText(visibleDays);
    const html = buildShoppingListHtml(visibleDays);
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
      <div key={`${day.date}-${meal.mealType}`} className="mb-3">
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
                        toggleIngredient(day.date, meal.mealType, ing.ingredientText, e.target.checked)
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
            disabled={visibleDays.length === 0}
          >
            ⬇️ Download
          </Button>
          <Button
            size="sm"
            variant="outline-secondary"
            onClick={handleCopy}
            disabled={visibleDays.length === 0}
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
    </>
  );

  if (bare) return body;

  return (
    <Card className="mt-4">
      <Card.Body>{body}</Card.Body>
    </Card>
  );
}
