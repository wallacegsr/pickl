import type { RecipeSearchFields } from "@/lib/recipeSearch";

/**
 * The Recipes page's query — its shape, defaults, and how it reads from and
 * writes to a URL. Kept free of the database so browser components can use it;
 * the query itself runs in src/lib/recipeQuery.ts.
 */

export type RecipeTab = "shared" | "mine";
export type RecipeSort = "name" | "newest" | "planned_recent" | "planned_least" | "planned_most";

export const RECIPE_SORTS: { value: RecipeSort; label: string }[] = [
  { value: "name", label: "Name (A–Z)" },
  { value: "newest", label: "Newest first" },
  { value: "planned_recent", label: "Recently planned" },
  { value: "planned_least", label: "Not planned lately" },
  { value: "planned_most", label: "Most planned" },
];

/** Meal types a recipe can be filtered by, as stored. */
export const FILTER_MEAL_TYPES = ["breakfast", "lunch", "dinner", "dessert", "any"] as const;

export const PAGE_SIZE = 50;
/** Tiles grow by "Show more"; this is as far as one request will go. */
export const MAX_LIMIT = 500;
/** "Select all matching" resolves to at most this many recipes. */
export const MAX_MATCHING = 5000;

export interface RecipeQuery {
  tab: RecipeTab;
  q: string;
  fields: RecipeSearchFields;
  mealTypes: string[];
  tags: string[];
  tagMatch: "all" | "any";
  favoritesOnly: boolean;
  /** Prep + cook, in minutes. Recipes with neither time recorded are left out. */
  maxMinutes: number | null;
  sort: RecipeSort;
  page: number;
  limit: number;
}

/** A recipe as the list shows it: no full method, no ingredients. */
export interface RecipeListRow {
  id: string;
  name: string;
  visibility: string;
  ownerUserId: string | null;
  mealType: string;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  servings: number | null;
  /** The start of the method, for the tile preview. */
  snippet: string;
  tags: string[];
  isFavorite: boolean;
  lastPlanned: string | null;
  timesPlanned: number;
}

export interface RecipeFacets {
  mealTypes: { value: string; count: number }[];
  tags: { name: string; count: number }[];
  favorites: number;
}

export interface RecipePage {
  rows: RecipeListRow[];
  /** Recipes matching every filter. */
  total: number;
  /** Recipes in the tab before any search or filter — tells "empty jar" from "no match". */
  tabTotal: number;
  page: number;
  limit: number;
  facets: RecipeFacets;
}

type Params = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
function many(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
}
function int(v: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/**
 * Reads a query from URL parameters. Lenient on purpose: this comes from an
 * address bar, so anything unrecognised falls back to the default rather than
 * becoming an error page.
 */
export function parseRecipeQuery(params: Params): RecipeQuery {
  const in_ = many(params.in);
  const fields: RecipeSearchFields =
    in_.length > 0
      ? { name: in_.includes("name"), tags: in_.includes("tags"), ingredients: in_.includes("ingredients") }
      : { name: true, tags: true, ingredients: true };
  const sort = one(params.sort) as RecipeSort;
  const max = one(params.max);
  return {
    tab: one(params.tab) === "mine" ? "mine" : "shared",
    q: (one(params.q) ?? "").slice(0, 200),
    fields,
    mealTypes: many(params.meal).filter((m) => (FILTER_MEAL_TYPES as readonly string[]).includes(m)),
    tags: many(params.tag).slice(0, 20),
    tagMatch: one(params.match) === "any" ? "any" : "all",
    favoritesOnly: one(params.fav) === "1",
    maxMinutes: max ? int(max, 30, 1, 1440) : null,
    sort: RECIPE_SORTS.some((s) => s.value === sort) ? sort : "name",
    page: int(one(params.page), 1, 1, 100000),
    limit: int(one(params.limit), PAGE_SIZE, 1, MAX_LIMIT),
  };
}

/** The inverse of parseRecipeQuery, leaving defaults out so URLs stay short. */
export function recipeQueryToParams(q: Partial<RecipeQuery>): URLSearchParams {
  const p = new URLSearchParams();
  if (q.tab === "mine") p.set("tab", "mine");
  if (q.q?.trim()) p.set("q", q.q);
  if (q.fields && !(q.fields.name && q.fields.tags && q.fields.ingredients)) {
    const on = (["name", "tags", "ingredients"] as const).filter((f) => q.fields![f]);
    // All three off searches nothing in particular; treat it as all on.
    if (on.length > 0) p.set("in", on.join(","));
  }
  if (q.mealTypes?.length) p.set("meal", q.mealTypes.join(","));
  for (const t of q.tags ?? []) p.append("tag", t);
  if ((q.tags?.length ?? 0) >= 2 && q.tagMatch === "any") p.set("match", "any");
  if (q.favoritesOnly) p.set("fav", "1");
  if (q.maxMinutes) p.set("max", String(q.maxMinutes));
  if (q.sort && q.sort !== "name") p.set("sort", q.sort);
  if (q.page && q.page > 1) p.set("page", String(q.page));
  if (q.limit && q.limit !== PAGE_SIZE) p.set("limit", String(q.limit));
  return p;
}

