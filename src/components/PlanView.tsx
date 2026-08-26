"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Form, Modal, Nav, Spinner } from "react-bootstrap";
import { todayDateString } from "@/lib/dates";
import type { MealType, Scope } from "@/db/schema";
import RecipeSearchBar from "@/components/RecipeSearchBar";
import { minAnimationElapsed } from "@/lib/shakeMotion";
import {
  DEFAULT_RECIPE_SEARCH_FIELDS,
  matchesRecipeSearch,
  type RecipeSearchFields,
} from "@/lib/recipeSearch";
import type { ShoppingListDayData } from "@/components/ShoppingListPanel";
import PlanDashboard from "@/components/plan/PlanDashboard";
import {
  PlanContextProvider,
  type OverlayResponse,
  type ExternalEventView,
} from "@/components/plan/PlanContext";
import type { DashboardLayout } from "@/lib/dashboard/widgets";

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

export interface PlanMealSlotData {
  mealType: MealType;
  entryId: string | null;
  recipe: { id: string; name: string } | null;
}

export interface PlanDayData {
  date: string;
  dayOfWeek: string;
  meals: Record<MealType, PlanMealSlotData>;
}

export interface RecipeOption {
  id: string;
  name: string;
  /** Tag names, attached server-side by src/lib/tags.ts. */
  tags: string[];
  ingredients: string;
}

/**
 * The /plan page's client root.
 *
 * Since the dashboard phase this component renders almost nothing itself.
 * What it owns is the page's *state* — the week's plan, the shake requests
 * and their two modals, and the calendar overlay fetch — while the visible
 * pieces live in removable widgets under src/components/plan/widgets and
 * read that state from PlanContext.
 *
 * Two things stayed here rather than moving into a widget, both for the same
 * reason: they must not disappear when a widget is taken off the board.
 *
 *  - The scope tabs and the admin's user picker decide *whose plan* the whole
 *    board is showing. They are page chrome, not a widget.
 *  - The 409 overwrite-confirmation modal and the manual slot editor are
 *    owned by whoever owns the request that opens them. A confirmation dialog
 *    that vanished mid-request because its widget was hidden would be a real
 *    bug; keeping both here makes that impossible.
 */
export default function PlanView({
  week,
  scope,
  targetUserId,
  requestedUserId,
  initialDays,
  shoppingListDays,
  recipePoolByMeal,
  canEditShared,
  isAdmin,
  currentUserId,
  householdUsers,
  overlayEnabled,
  dashboardLayout,
}: {
  week: string;
  scope: Scope;
  targetUserId: string;
  requestedUserId: string;
  initialDays: PlanDayData[];
  /**
   * Passed straight down to the shopping-list widget by reference — see the
   * note in PlanContext. Its identity changing is what tells that widget a
   * shake has landed, so this must not be transformed on the way through.
   */
  shoppingListDays: ShoppingListDayData[];
  recipePoolByMeal: Record<MealType, RecipeOption[]>;
  canEditShared: boolean;
  isAdmin: boolean;
  currentUserId: string;
  householdUsers: { id: string; name: string; email: string }[];
  /**
   * The viewer's opt-in for the calendar read-back overlay. A hint only:
   * the server re-checks it, and re-checks whose plan this is, before any
   * calendar is read. When it's false no request is made at all.
   */
  overlayEnabled: boolean;
  /** This user's own dashboard arrangement, already reconciled server-side. */
  dashboardLayout: DashboardLayout;
}) {
  const router = useRouter();
  const today = todayDateString();

  const isEditable = scope === "shared" ? canEditShared : true;

  const [days, setDays] = useState<PlanDayData[]>(initialDays);
  // Server passes fresh initialDays on navigation (e.g. switching Household <-> Private,
  // or admin switching which user's private plan is being viewed), but this component
  // instance persists across client-side router.push navigations, so useState's initial
  // value is only used once. Re-sync local state whenever the identity of "what plan we're
  // viewing" changes so tab/user switches don't show stale data from the previous view.
  useEffect(() => {
    setDays(initialDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, requestedUserId, week]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // --- Calendar read-back overlay ------------------------------------------
  // Deliberately fetched from the client AFTER the grid has painted, rather
  // than awaited during the server render. The guarantee this owes is that a
  // slow, hung or broken calendar cannot delay or break the plan: the
  // cheapest way to keep that promise is for the server render never to
  // touch the calendar at all. The grid is complete on first paint and the
  // overlay drops in when (or if) it arrives.
  //
  // The dashboard did not change this. The grid widget and the calendar
  // widget both read the single result held here, so adding the calendar
  // widget to the board cannot introduce a second request, and the fetch
  // still starts after paint regardless of which widgets are placed.
  //
  // The overlay is never shown on someone else's plan. That is enforced
  // server-side in src/lib/calendar/read.ts; skipping the request here just
  // avoids asking a question we already know the answer to.
  const overlayApplies =
    overlayEnabled && (scope === "shared" || requestedUserId === currentUserId);
  const [overlay, setOverlay] = useState<OverlayResponse | null>(null);

  useEffect(() => {
    if (!overlayApplies) {
      setOverlay(null);
      return;
    }
    // Ignore a response that lands after the user has navigated to another
    // week or plan, so one view can never render another view's events.
    let cancelled = false;
    setOverlay(null);
    const params = new URLSearchParams({ week, scope });
    if (scope === "private") params.set("userId", requestedUserId);
    fetch(`/api/calendar/overlay?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: OverlayResponse | null) => {
        if (cancelled) return;
        setOverlay(
          data && Array.isArray(data.events)
            ? data
            : // A transport failure is the same quiet non-event as a
              // provider failure: an inline note, never an error alert.
              { status: "error", events: [], message: "Couldn't load your calendar events." }
        );
      })
      .catch(() => {
        if (!cancelled) {
          setOverlay({
            status: "error",
            events: [],
            message: "Couldn't load your calendar events.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [overlayApplies, week, scope, requestedUserId]);

  const [expandedOverlayDates, setExpandedOverlayDates] = useState<string[]>([]);

  const overlayByDate = new Map<string, ExternalEventView[]>();
  for (const event of overlay?.events ?? []) {
    const list = overlayByDate.get(event.date);
    if (list) list.push(event);
    else overlayByDate.set(event.date, [event]);
  }

  const [selectedMeals, setSelectedMeals] = useState<MealType[]>(["dinner"]);
  const [overwriteWeek, setOverwriteWeek] = useState(false);

  const [crunchingToday, setCrunchingToday] = useState(false);
  const [shakingWeek, setShakingWeek] = useState(false);
  const [reveal, setReveal] = useState<string | null>(null);

  const [conflicts, setConflicts] = useState<
    { mealType: MealType; currentRecipe: { name: string } | null }[]
  >([]);
  const [confirmReplaceToday, setConfirmReplaceToday] = useState(false);

  const [editingSlot, setEditingSlot] = useState<{
    date: string;
    dayOfWeek: string;
    mealType: MealType;
    recipeId: string;
  } | null>(null);
  const [savingSlot, setSavingSlot] = useState(false);
  const [slotSearch, setSlotSearch] = useState("");
  const [slotSearchFields, setSlotSearchFields] = useState<RecipeSearchFields>(
    DEFAULT_RECIPE_SEARCH_FIELDS
  );

  function navScope(nextScope: Scope, userId?: string) {
    const params = new URLSearchParams({ week, scope: nextScope });
    if (nextScope === "private") {
      params.set("userId", userId || currentUserId);
    }
    router.push(`/plan?${params.toString()}`);
  }

  async function fetchLatestDays() {
    const params = new URLSearchParams({ week, scope });
    if (scope === "private") params.set("userId", requestedUserId);
    const res = await fetch(`/api/plan?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      setDays(data.days);
    }
  }

  function toggleMeal(mealType: MealType) {
    setSelectedMeals((prev) =>
      prev.includes(mealType) ? prev.filter((m) => m !== mealType) : [...prev, mealType]
    );
  }

  async function handleCrunchToday(force = false) {
    if (selectedMeals.length === 0) {
      setError("Pick at least one meal to shake for.");
      return;
    }
    setError(null);
    setInfo(null);
    setReveal(null);
    setCrunchingToday(true);
    // The pickle starts crunching on this render; the request is already in flight
    // below, so the two overlap rather than queueing.
    const startedAt = Date.now();

    let res: Response;
    try {
      res = await fetch("/api/plan/spin-today", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mealTypes: selectedMeals,
          scope,
          userId: scope === "private" ? requestedUserId : undefined,
          force,
        }),
      });
    } catch {
      // Stop the animation straight away — a failure is not worth animating.
      setCrunchingToday(false);
      setError("Could not reach the server. Please try again.");
      return;
    }

    // Failures (including the 409 overwrite-confirmation flow) short-circuit
    // the minimum animation time so the modal/alert appears immediately.
    if (res.status === 409) {
      setCrunchingToday(false);
      const data = await res.json().catch(() => ({}));
      setConflicts(data.conflicts ?? []);
      setConfirmReplaceToday(true);
      return;
    }

    if (!res.ok) {
      setCrunchingToday(false);
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not pick a recipe for tonight.");
      return;
    }

    const data = await res.json();
    await minAnimationElapsed(startedAt);
    setCrunchingToday(false);

    const picked: string[] = (data.results ?? [])
      .map((r: { recipe: { name: string } | null }) => r.recipe?.name)
      .filter(Boolean);
    if (picked.length > 0) setReveal(`Out of the jar: ${picked.join(", ")}`);
    if (data.note) setInfo(data.note);
    setConfirmReplaceToday(false);
    await fetchLatestDays();
    // Rebuilds the server component, which is what hands the shopping-list
    // widget a fresh `shoppingListDays` array and keeps it in step with the
    // shake without a page reload.
    router.refresh();
  }

  async function handleShakeWeek() {
    if (selectedMeals.length === 0) {
      setError("Pick at least one meal to shake for.");
      return;
    }
    setError(null);
    setInfo(null);
    setReveal(null);
    setShakingWeek(true);
    const startedAt = Date.now();

    let res: Response;
    try {
      res = await fetch("/api/plan/spin-week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mealTypes: selectedMeals,
          scope,
          userId: scope === "private" ? requestedUserId : undefined,
          overwriteExisting: overwriteWeek,
        }),
      });
    } catch {
      setShakingWeek(false);
      setError("Could not reach the server. Please try again.");
      return;
    }

    if (!res.ok) {
      setShakingWeek(false);
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not fill the rest of the week.");
      return;
    }

    const data = await res.json();
    await minAnimationElapsed(startedAt);
    setShakingWeek(false);

    const filled: number = (data.filledDates ?? []).length;
    if (filled > 0) {
      setReveal(
        `Shaken out ${filled} meal${filled === 1 ? "" : "s"} through Saturday.`
      );
    }
    if (data.note) setInfo(data.note);
    await fetchLatestDays();
    router.refresh();
  }

  function openSlotEditor(day: PlanDayData, mealType: MealType) {
    if (!isEditable) return;
    setSlotSearch("");
    setSlotSearchFields(DEFAULT_RECIPE_SEARCH_FIELDS);
    setEditingSlot({
      date: day.date,
      dayOfWeek: day.dayOfWeek,
      mealType,
      recipeId: day.meals[mealType]?.recipe?.id ?? "",
    });
  }

  async function saveSlot() {
    if (!editingSlot) return;
    setSavingSlot(true);
    const res = await fetch("/api/plan", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: editingSlot.date,
        mealType: editingSlot.mealType,
        recipeId: editingSlot.recipeId || null,
        scope,
        userId: scope === "private" ? requestedUserId : undefined,
      }),
    });
    setSavingSlot(false);
    if (res.ok) {
      setEditingSlot(null);
      await fetchLatestDays();
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not update this slot.");
    }
  }


  return (
    <div>
      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {info && (
        <Alert variant="info" dismissible onClose={() => setInfo(null)}>
          {info}
        </Alert>
      )}
      {reveal && (
        <Alert
          variant="success"
          className="jar-reveal"
          dismissible
          onClose={() => setReveal(null)}
        >
          {reveal}
        </Alert>
      )}

      <Nav
        variant="tabs"
        activeKey={scope}
        className="mb-3"
        onSelect={(k) => navScope((k as Scope) ?? "shared")}
      >
        <Nav.Item>
          <Nav.Link eventKey="shared">Household</Nav.Link>
        </Nav.Item>
        <Nav.Item>
          <Nav.Link eventKey="private">My Private Plan</Nav.Link>
        </Nav.Item>
      </Nav>

      {scope === "private" && isAdmin && (
        <Form.Group className="mb-3" style={{ maxWidth: 320 }}>
          <Form.Label className="small text-muted">Viewing calendar for</Form.Label>
          <Form.Select
            value={requestedUserId}
            onChange={(e) => navScope("private", e.target.value)}
          >
            {householdUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.id === currentUserId ? `${u.name} (you)` : u.name}
              </option>
            ))}
          </Form.Select>
        </Form.Group>
      )}

      {scope === "shared" && !isEditable && (
        <Alert variant="secondary" className="py-2">
          You have view-only access to the household calendar.
        </Alert>
      )}

      <PlanContextProvider
        value={{
          week,
          scope,
          requestedUserId,
          today,
          isEditable,
          days,
          recipePoolByMeal,
          openSlotEditor,
          selectedMeals,
          toggleMeal,
          overwriteWeek,
          setOverwriteWeek,
          crunchingToday,
          shakingWeek,
          onCrunchToday: () => handleCrunchToday(false),
          onShakeWeek: handleShakeWeek,
          shoppingListDays,
          overlayEnabled,
          overlayApplies,
          overlay,
          overlayByDate,
          expandedOverlayDates,
          expandOverlayDate: (date) =>
            setExpandedOverlayDates((prev) => [...prev, date]),
          collapseOverlayDate: (date) =>
            setExpandedOverlayDates((prev) => prev.filter((d) => d !== date)),
        }}
      >
        <PlanDashboard initialLayout={dashboardLayout} />
      </PlanContextProvider>

      {/* Confirm replace today's conflicting meals */}
      <Modal show={confirmReplaceToday} onHide={() => setConfirmReplaceToday(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Replace today&apos;s picks?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>The following meals today already have a recipe planned:</p>
          <ul>
            {conflicts.map((c) => (
              <li key={c.mealType}>
                {MEAL_LABELS[c.mealType]}: {c.currentRecipe?.name ?? "a recipe"}
              </li>
            ))}
          </ul>
          <p>Replace them with new random picks?</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setConfirmReplaceToday(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => handleCrunchToday(true)}>
            Replace
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Manual slot editor */}
      <Modal show={Boolean(editingSlot)} onHide={() => setEditingSlot(null)}>
        <Modal.Header closeButton>
          <Modal.Title>
            {editingSlot
              ? `${MEAL_LABELS[editingSlot.mealType]} — ${editingSlot.dayOfWeek} (${editingSlot.date})`
              : ""}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-3" controlId="slot-recipe-search">
            <Form.Label>Search recipes</Form.Label>
            <RecipeSearchBar
              idPrefix="slot-recipe-search"
              query={slotSearch}
              onQueryChange={setSlotSearch}
              fields={slotSearchFields}
              onFieldsChange={setSlotSearchFields}
              placeholder="Search by name, tag, or ingredient..."
              size="sm"
            />
          </Form.Group>
          <Form.Group controlId="slot-recipe-select">
            <Form.Label>Assigned Recipe</Form.Label>
            <Form.Select
              value={editingSlot?.recipeId ?? ""}
              onChange={(e) =>
                setEditingSlot((prev) =>
                  prev ? { ...prev, recipeId: e.target.value } : prev
                )
              }
            >
              <option value="">-- No recipe / clear --</option>
              {editingSlot &&
                (() => {
                  const pool = recipePoolByMeal[editingSlot.mealType] ?? [];
                  const matched = pool.filter((r) =>
                    matchesRecipeSearch(r, slotSearch, slotSearchFields)
                  );
                  // Keep the currently-assigned recipe selectable/visible even if it
                  // no longer matches the search, so the dropdown doesn't silently
                  // lose track of the current selection while filtering.
                  const current = pool.find((r) => r.id === editingSlot.recipeId);
                  const options =
                    current && !matched.some((r) => r.id === current.id)
                      ? [current, ...matched]
                      : matched;
                  return options.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ));
                })()}
            </Form.Select>
            {editingSlot &&
              slotSearch.trim() &&
              !(recipePoolByMeal[editingSlot.mealType] ?? []).some((r) =>
                matchesRecipeSearch(r, slotSearch, slotSearchFields)
              ) && (
                <Form.Text className="text-muted">
                  No recipes match this search for {MEAL_LABELS[editingSlot.mealType]}.
                </Form.Text>
              )}
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setEditingSlot(null)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={saveSlot} disabled={savingSlot}>
            {savingSlot ? <Spinner animation="border" size="sm" /> : "Save"}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
