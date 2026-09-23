"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Badge,
  Button,
  Form,
  ListGroup,
  Modal,
  Nav,
  Spinner,
} from "react-bootstrap";
import type { MealType, Scope } from "@/db/schema";
import { minAnimationElapsed } from "@/lib/shakeMotion";
import {
  DEFAULT_RECIPE_SEARCH_FIELDS,
  matchesRecipeSearch,
  type RecipeSearchFields,
} from "@/lib/recipeSearch";
import type { ShoppingListDayData } from "@/components/ShoppingListPanel";
import PlanDashboard from "@/components/plan/PlanDashboard";
import SlotPicker, { type SlotPickerChips } from "@/components/plan/SlotPicker";
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

export interface PlannedRecipeData {
  entryId: string;
  recipe: { id: string; name: string };
  position: number;
  /** Drives the chip colour: desserts are told apart by category, not order. */
  isDessert: boolean;
}

export interface PlanMealSlotData {
  mealType: MealType;
  /** Every recipe in this slot, in order. Empty is the "Empty jar" case. */
  recipes: PlannedRecipeData[];
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
  /** Stored comma-separated meal types, so the picker can search by them. */
  mealType: string;
  // Note: `ingredients` is filled in only for recipes planned in the week on
  // screen; elsewhere it is "". See the plan page for why.
  /** The viewer's own star. */
  isFavorite: boolean;
  /** Last date this recipe was planned on a calendar the viewer can see. */
  lastPlanned: string | null;
  /** Prep + cook, when either is recorded. */
  totalMinutes: number | null;
  /** Which meals' pools this recipe is in — the picker for a lunch slot offers the lunch pool. */
  pools: MealType[];
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
  today,
  scope,
  targetUserId,
  requestedUserId,
  initialDays,
  shoppingListDays,
  recipes,
  pickerChips,
  canEditShared,
  isAdmin,
  currentUserId,
  householdUsers,
  overlayEnabled,
  dashboardLayout,
}: {
  week: string;
  /** Today where the viewer is, from the server (see src/lib/viewerToday.ts). */
  today: string;
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
  /** Every recipe any meal on this calendar can use, each once, tagged with which meals. */
  recipes: RecipeOption[];
  /** Which tag chips the slot picker offers; see the Appearance preferences. */
  pickerChips: SlotPickerChips;
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

  const isEditable = scope === "shared" ? canEditShared : true;

  // The per-meal pools, rebuilt here. The server sends each recipe once with
  // the meals it suits; the widgets still get the Record they always have.
  const recipePoolByMeal = useMemo(() => {
    const pools = { breakfast: [], lunch: [], dinner: [] } as Record<MealType, RecipeOption[]>;
    for (const r of recipes) for (const meal of r.pools) pools[meal]?.push(r);
    return pools;
  }, [recipes]);

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
  // Off by default: a shake should not start proposing cake unless asked.
  const [includeDessert, setIncludeDessert] = useState(false);
  const [overwriteWeek, setOverwriteWeek] = useState(false);
  // What the jar may pick from, beyond the meal type. Empty tags and no
  // favorites means "everything", which is how it behaved before these existed.
  const [spinTags, setSpinTags] = useState<string[]>([]);
  const [spinTagMatch, setSpinTagMatch] = useState<"all" | "any">("all");
  const [spinFavoritesOnly, setSpinFavoritesOnly] = useState(false);
  // Offered tags come from the recipes the jar could actually pick, so a tag
  // no eligible recipe carries is never on the menu.
  const spinTagOptions = useMemo(() => {
    // Counted per recipe across the meals ticked, so a recipe in both the
    // lunch and dinner pools counts once.
    const recipesByKey = new Map<string, { name: string; ids: Set<string> }>();
    const meals = selectedMeals.length ? selectedMeals : (Object.keys(recipePoolByMeal) as MealType[]);
    for (const meal of meals)
      for (const r of recipePoolByMeal[meal] ?? [])
        for (const t of r.tags) {
          const key = t.toLowerCase();
          const entry = recipesByKey.get(key) ?? { name: t, ids: new Set<string>() };
          entry.ids.add(r.id);
          recipesByKey.set(key, entry);
        }
    return [...recipesByKey.values()]
      .map((e) => ({ name: e.name, count: e.ids.size }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [recipePoolByMeal, selectedMeals]);

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
    /** Ordered: an id's index here becomes the slot's display order. */
    recipeIds: string[];
  } | null>(null);
  const [savingSlot, setSavingSlot] = useState(false);

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
          includeDessert,
          scope,
          userId: scope === "private" ? requestedUserId : undefined,
          force,
          tags: spinTags,
          tagMatch: spinTagMatch,
          favoritesOnly: spinFavoritesOnly,
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
          includeDessert,
          scope,
          userId: scope === "private" ? requestedUserId : undefined,
          overwriteExisting: overwriteWeek,
          tags: spinTags,
          tagMatch: spinTagMatch,
          favoritesOnly: spinFavoritesOnly,
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
    // Past days are read-only; the server refuses too.
    if (day.date < today) return;
    setEditingSlot({
      date: day.date,
      dayOfWeek: day.dayOfWeek,
      mealType,
      recipeIds: (day.meals[mealType]?.recipes ?? []).map((p) => p.recipe.id),
    });
  }

  /**
   * Saves the slot. Takes an optional list so double-clicking a result can
   * pick and save in one gesture: setEditingSlot is async, so reading it back
   * here would save whatever was selected before the double-click.
   */
  async function saveSlot(recipeIdsOverride?: string[]) {
    if (!editingSlot) return;
    const recipeIds = recipeIdsOverride ?? editingSlot.recipeIds;
    setSavingSlot(true);
    const res = await fetch("/api/plan", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: editingSlot.date,
        mealType: editingSlot.mealType,
        recipeIds,
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
        includeDessert,
        setIncludeDessert,
          overwriteWeek,
          setOverwriteWeek,
          spinTags,
          setSpinTags,
          spinTagMatch,
          setSpinTagMatch,
          spinFavoritesOnly,
          setSpinFavoritesOnly,
          spinTagOptions,
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

      {/* Manual slot editor — a sheet on a phone, a dialog at a desk. */}
      <SlotPicker
        show={Boolean(editingSlot)}
        title={editingSlot ? `${editingSlot.dayOfWeek} ${MEAL_LABELS[editingSlot.mealType].toLowerCase()}` : ""}
        subtitle={
          editingSlot
            ? `${editingSlot.date}${
                editingSlot.recipeIds.length ? ` · ${editingSlot.recipeIds.length} chosen` : ""
              }`
            : ""
        }
        pool={editingSlot ? recipePoolByMeal[editingSlot.mealType] ?? [] : []}
        selectedIds={editingSlot?.recipeIds ?? []}
        chips={pickerChips}
        saving={savingSlot}
        onChange={(ids) => setEditingSlot((prev) => (prev ? { ...prev, recipeIds: ids } : prev))}
        onSave={() => void saveSlot()}
        onCancel={() => setEditingSlot(null)}
      />
    </div>
  );
}
