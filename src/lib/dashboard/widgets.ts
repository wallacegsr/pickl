/**
 * The /plan dashboard's widget registry, and the rules for turning whatever
 * happens to be stored in `dashboard_layouts.layout_json` into something the
 * page can actually render.
 *
 * This module is deliberately dependency-free (no React, no database, no
 * `next/*`) so the same code runs on the server when the page is rendered,
 * in the API route when a layout is saved, and in the browser when the user
 * drags something. One definition of "what a valid layout is", used by every
 * one of those three.
 *
 * The registry below is the single source of truth for which widgets exist.
 * Adding a widget means adding an entry here (plus a component in the
 * client-side WIDGET_COMPONENTS map); removing one means deleting an entry.
 * Neither requires touching stored data — see reconcileLayout().
 */

export const WIDGET_IDS = [
  "plan-grid",
  "shake-controls",
  "shopping-list",
  "recipe-quick-look",
  "calendar-events",
] as const;

export type WidgetId = (typeof WIDGET_IDS)[number];

export function isWidgetId(value: unknown): value is WidgetId {
  return (
    typeof value === "string" && (WIDGET_IDS as readonly string[]).includes(value)
  );
}

/** Columns the desktop grid is measured in. Stored x/w are in these units. */
export const DASHBOARD_COLS = 12;
/** Pixel height of one grid row. Stored h is in these units. */
export const DASHBOARD_ROW_HEIGHT = 40;
export const DASHBOARD_MARGIN: [number, number] = [16, 16];

/**
 * Below this viewport width the grid is not rendered at all: widgets become
 * a plain stacked list in `mobileOrder`. Matches Bootstrap's `md` breakpoint
 * so the dashboard changes shape at the same width as everything else on the
 * page. See PlanDashboard for why this is a hard swap rather than a
 * one-column grid.
 */
export const DASHBOARD_STACK_BREAKPOINT = 768;

export interface WidgetPlacement {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WidgetMeta {
  id: WidgetId;
  /** Shown in the widget header, the add/remove menu, and as its aria-label. */
  title: string;
  /** One line in the add-widget menu, explaining what it is. */
  description: string;
  minW: number;
  minH: number;
  /** Where this widget sits for a user who has never arranged anything. */
  defaultPlacement: WidgetPlacement;
  /**
   * Position in the stacked mobile list, and the order in which a widget
   * missing from a stored layout is appended. Lower comes first.
   */
  mobileOrder: number;
}

/**
 * Default arrangement: a wide left column for the week itself, a narrow right
 * column for the things you consult while planning it.
 *
 *   Shake the jar  (8 wide) | Recipe quick look (4 wide)
 *   Meal plan      (8 wide) | Shopping list     (4 wide)
 *   Calendar events        (full width)
 *
 * Shaking sits directly above the grid it fills in, so the cause is next to
 * its effect. Tonight's recipe and the shopping list stack down the right,
 * both being things you read rather than act on. The calendar overlay spans
 * the bottom because it is opt-in, and an empty one-line notice for anyone
 * who has not turned it on.
 */
export const WIDGET_REGISTRY: Record<WidgetId, WidgetMeta> = {
  "plan-grid": {
    id: "plan-grid",
    title: "Meal plan",
    description: "The Sunday–Saturday grid, with your calendar column.",
    minW: 4,
    minH: 6,
    // 11 rows = 600px, against ~562px of content for a fully planned week.
    defaultPlacement: { x: 0, y: 3, w: 8, h: 12 },
    mobileOrder: 1,
  },
  "shake-controls": {
    id: "shake-controls",
    title: "Shake the jar",
    description: "Pick meals, then Crunch Time or Shake the Jar.",
    minW: 3,
    // The controls are a checkbox row and two buttons: ~150px. minH was 4,
    // which forced 208px and was most of the empty space here.
    minH: 3,
    // 3 rows = 152px.
    defaultPlacement: { x: 0, y: 0, w: 8, h: 3 },
    mobileOrder: 0,
  },
  "recipe-quick-look": {
    id: "recipe-quick-look",
    title: "Recipe quick look",
    description: "Search the jar and see tonight's recipe at a glance.",
    minW: 3,
    minH: 5,
    // 8 rows = 432px, against ~381px of content.
    defaultPlacement: { x: 8, y: 0, w: 4, h: 8 },
    mobileOrder: 2,
  },
  "shopping-list": {
    id: "shopping-list",
    title: "Shopping list",
    description: "Today or the full week's ingredients, with export.",
    minW: 3,
    minH: 6,
    // Deliberately smaller than its content. A full week of ingredients runs
    // ~900px (17 rows); at that height it would push everything else off
    // screen, so it keeps 12 rows and scrolls instead.
    defaultPlacement: { x: 8, y: 8, w: 4, h: 7 },
    mobileOrder: 3,
  },
  "calendar-events": {
    id: "calendar-events",
    title: "Calendar events",
    description: "Your own external calendar for this week. Only you see it.",
    minW: 3,
    minH: 5,
    // The overlay is opt-in and off by default, so the common first-run state
    // is a one-line notice (~123px). 5 rows = 264px leaves room for a few
    // events once it is switched on, without reserving 9 rows for a message.
    defaultPlacement: { x: 0, y: 15, w: 12, h: 4 },
    mobileOrder: 4,
  },
};

export const WIDGET_LIST: WidgetMeta[] = WIDGET_IDS.map(
  (id) => WIDGET_REGISTRY[id]
);

export interface DashboardLayoutItem extends WidgetPlacement {
  i: WidgetId;
  minW: number;
  minH: number;
}

export interface DashboardLayout {
  /**
   * Bumped only if the *meaning* of the stored fields changes. It is not a
   * gate on adding or removing widgets — reconcileLayout handles that
   * without a version bump, which is the whole point of it.
   */
  v: 1;
  items: DashboardLayoutItem[];
  /**
   * Widgets the user has taken off the board on purpose. Kept explicitly so
   * that "I removed the shopping list" survives a reload, and is
   * distinguishable from "this widget did not exist when I last saved" —
   * the latter gets added back, the former does not.
   *
   * Nothing here deletes anything. A hidden widget's data (plan entries,
   * on-hand ticks, recipes) is untouched; only the view is gone.
   */
  hidden: WidgetId[];
}

export const DASHBOARD_LAYOUT_VERSION = 1 as const;

export function defaultDashboardLayout(): DashboardLayout {
  return {
    v: DASHBOARD_LAYOUT_VERSION,
    items: WIDGET_LIST.map((meta) => ({
      i: meta.id,
      ...meta.defaultPlacement,
      minW: meta.minW,
      minH: meta.minH,
    })),
    hidden: [],
  };
}

function toFiniteInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

/**
 * Turns arbitrary stored JSON into a layout that is safe to render.
 *
 * Every failure mode here resolves to *something on screen*. A stale layout
 * must never produce a blank page, so the four cases below are all handled
 * without an error path:
 *
 *  1. Unparseable / wrong-shaped JSON, or no row at all → the default layout.
 *  2. An item naming a widget that no longer exists → dropped silently. The
 *     id is not in the registry, so there is nothing to render and nothing
 *     to warn about; the user never chose it, a past release did.
 *  3. A widget added in a later release that the stored layout has never
 *     heard of → appended at the bottom in `mobileOrder`, at its default
 *     size. New widgets show up rather than being invisible until a reset.
 *     A widget the user explicitly removed stays removed (`hidden`).
 *  4. Nonsense geometry (NaN, negative, wider than the grid, below the
 *     widget's own minimum) → clamped into range rather than rejected.
 *
 * The result is always a layout whose items are all real widgets and whose
 * geometry is in-bounds. It may legitimately be empty — a user is allowed to
 * remove every widget — and the UI handles that with an empty state plus a
 * reset, which is a different thing from a blank screen.
 */
export function reconcileLayout(raw: unknown): DashboardLayout {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;

  if (!source || !Array.isArray(source.items)) {
    return defaultDashboardLayout();
  }

  const hidden: WidgetId[] = Array.isArray(source.hidden)
    ? (source.hidden.filter(isWidgetId) as WidgetId[])
    : [];
  const hiddenSet = new Set<WidgetId>(hidden);

  const seen = new Set<WidgetId>();
  const items: DashboardLayoutItem[] = [];

  for (const entry of source.items) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    // Case 2: an id the registry no longer knows about.
    if (!isWidgetId(item.i)) continue;
    // A widget cannot be both placed and hidden; placement wins, since it is
    // the thing that would otherwise render twice.
    if (seen.has(item.i)) continue;
    seen.add(item.i);
    hiddenSet.delete(item.i);

    const meta = WIDGET_REGISTRY[item.i];
    const w = Math.min(
      DASHBOARD_COLS,
      Math.max(meta.minW, toFiniteInt(item.w, meta.defaultPlacement.w))
    );
    const h = Math.max(meta.minH, toFiniteInt(item.h, meta.defaultPlacement.h));
    const x = Math.min(
      DASHBOARD_COLS - w,
      Math.max(0, toFiniteInt(item.x, meta.defaultPlacement.x))
    );
    const y = Math.max(0, toFiniteInt(item.y, meta.defaultPlacement.y));

    items.push({ i: item.i, x, y, w, h, minW: meta.minW, minH: meta.minH });
  }

  // Case 3: registry entries the stored layout has never placed and the user
  // has never removed. Appended below everything else, in registry order.
  let nextY = items.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  for (const meta of [...WIDGET_LIST].sort(
    (a, b) => a.mobileOrder - b.mobileOrder
  )) {
    if (seen.has(meta.id) || hiddenSet.has(meta.id)) continue;
    items.push({
      i: meta.id,
      x: 0,
      y: nextY,
      w: meta.defaultPlacement.w,
      h: meta.defaultPlacement.h,
      minW: meta.minW,
      minH: meta.minH,
    });
    nextY += meta.defaultPlacement.h;
  }

  return {
    v: DASHBOARD_LAYOUT_VERSION,
    items,
    hidden: WIDGET_IDS.filter((id) => hiddenSet.has(id)),
  };
}

/** Parses the stored JSON text. Never throws; bad text becomes the default. */
export function parseStoredLayout(json: string | null | undefined): DashboardLayout {
  if (!json) return defaultDashboardLayout();
  try {
    return reconcileLayout(JSON.parse(json));
  } catch {
    return defaultDashboardLayout();
  }
}

/**
 * Reading order for the stacked (mobile) rendering and for the keyboard
 * reorder list: top-to-bottom, then left-to-right, exactly as the grid reads
 * on screen. On a phone the grid is not rendered, so this is derived from the
 * saved desktop geometry rather than from `mobileOrder` — a user who has
 * arranged their desktop board gets that same order on their phone. Widgets
 * with no meaningful geometry fall back to `mobileOrder`.
 */
export function visibleWidgetsInReadingOrder(
  layout: DashboardLayout
): DashboardLayoutItem[] {
  return [...layout.items].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    if (a.x !== b.x) return a.x - b.x;
    return WIDGET_REGISTRY[a.i].mobileOrder - WIDGET_REGISTRY[b.i].mobileOrder;
  });
}

/** Widgets not currently on the board — what the "Add widget" menu offers. */
export function availableWidgets(layout: DashboardLayout): WidgetMeta[] {
  const placed = new Set(layout.items.map((item) => item.i));
  return WIDGET_LIST.filter((meta) => !placed.has(meta.id));
}

/** Places a widget back on the board, below everything currently on it. */
export function addWidget(
  layout: DashboardLayout,
  id: WidgetId
): DashboardLayout {
  if (layout.items.some((item) => item.i === id)) return layout;
  const meta = WIDGET_REGISTRY[id];
  const nextY = layout.items.reduce(
    (max, item) => Math.max(max, item.y + item.h),
    0
  );
  return {
    v: DASHBOARD_LAYOUT_VERSION,
    items: [
      ...layout.items,
      {
        i: id,
        x: 0,
        y: nextY,
        w: meta.defaultPlacement.w,
        h: meta.defaultPlacement.h,
        minW: meta.minW,
        minH: meta.minH,
      },
    ],
    hidden: layout.hidden.filter((h) => h !== id),
  };
}

/**
 * Takes a widget off the board. This is a view change only: no plan entry,
 * ingredient tick or recipe is touched, and the widget can be put back from
 * the Add menu with its data exactly as it was.
 */
export function removeWidget(
  layout: DashboardLayout,
  id: WidgetId
): DashboardLayout {
  if (!layout.items.some((item) => item.i === id)) return layout;
  return {
    v: DASHBOARD_LAYOUT_VERSION,
    items: layout.items.filter((item) => item.i !== id),
    hidden: WIDGET_IDS.filter((w) => w === id || layout.hidden.includes(w)),
  };
}

/**
 * Swaps a widget with its neighbour in reading order, keeping both boxes'
 * geometry — the keyboard equivalent of dragging one past the other.
 *
 * Swapping the two placements (rather than recomputing a fresh flow) means
 * the board keeps whatever shape the user gave it: a half-width widget moved
 * up takes over the half-width slot above it, and nothing else on the board
 * moves. `direction` is -1 for earlier, +1 for later.
 */
export function moveWidget(
  layout: DashboardLayout,
  id: WidgetId,
  direction: -1 | 1
): DashboardLayout {
  const ordered = visibleWidgetsInReadingOrder(layout);
  const index = ordered.findIndex((item) => item.i === id);
  if (index < 0) return layout;
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= ordered.length) return layout;

  const a = ordered[index];
  const b = ordered[targetIndex];
  const items = layout.items.map((item) => {
    if (item.i === a.i) return { ...item, x: b.x, y: b.y, w: b.w, h: b.h };
    if (item.i === b.i) return { ...item, x: a.x, y: a.y, w: a.w, h: a.h };
    return item;
  });
  // Back through reconcile: two widgets can declare different minW/minH, so a
  // straight swap could hand one a box smaller than it is allowed to be.
  return reconcileLayout({
    v: DASHBOARD_LAYOUT_VERSION,
    items,
    hidden: layout.hidden,
  });
}
