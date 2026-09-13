"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  Alert,
  Badge,
  Button,
  ButtonGroup,
  Col,
  Form,
  Nav,
  Offcanvas,
  Pagination,
  Row,
} from "react-bootstrap";
import { usePathname, useRouter } from "next/navigation";
import RecipeSearchBar from "@/components/RecipeSearchBar";
import { RecipeCards, RecipeTable } from "@/components/recipes/recipeViews";
import RecipeBulkConfirm, { type BulkRequest } from "@/components/recipes/RecipeBulkConfirm";
import RecipeTagPicker from "@/components/recipes/RecipeTagPicker";
import RecipeFilters from "@/components/recipes/RecipeFilters";
import type { BulkSummary } from "@/lib/recipeBulk";
import {
  MAX_LIMIT,
  PAGE_SIZE,
  RECIPE_SORTS,
  recipeQueryToParams,
  type RecipeListRow,
  type RecipePage,
  type RecipeQuery,
  type RecipeSort,
} from "@/lib/recipeQueryParams";
import { tagKey } from "@/lib/tagNames";

type View = "cards" | "list";

/**
 * Per device, like the sidebar's collapsed state: how someone likes a list
 * laid out is a property of the screen they are looking at, not of their
 * account. A phone and a desktop can each keep their own.
 */
const VIEW_STORAGE_KEY = "pickl-recipe-view-v1";
/** With no saved choice, a jar bigger than this opens as a list. */
const LIST_BY_DEFAULT_ABOVE = 200;
const SEARCH_DEBOUNCE_MS = 300;

/**
 * The Recipes page. The server does the searching, filtering, sorting and
 * paging (src/lib/recipeQuery.ts); this component turns clicks into a new URL
 * and draws the page of results that comes back.
 *
 * The URL is the state. So a filtered, sorted page 3 survives a refresh and
 * the back button, and can be bookmarked or sent to someone.
 */
export default function RecipeList({
  data,
  query,
  currentUserId,
  isAdmin,
  existingTags = [],
}: {
  data: RecipePage;
  query: RecipeQuery;
  currentUserId: string;
  isAdmin: boolean;
  /** Tag names this person may see, for the bulk "Tag…" autocomplete. */
  existingTags?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  /** Navigates to the query with `patch` applied. Filters reset to page 1. */
  function update(patch: Partial<RecipeQuery>) {
    const next: RecipeQuery = { ...query, page: 1, ...patch };
    // Growing the tile list is only for the view it was grown in.
    if (!("limit" in patch)) next.limit = PAGE_SIZE;
    const qs = recipeQueryToParams(next).toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  // --- Search box: typed locally, sent after a pause ---
  const [search, setSearch] = useState(query.q);
  useEffect(() => setSearch(query.q), [query.q]);
  useEffect(() => {
    if (search === query.q) return;
    const t = window.setTimeout(() => update({ q: search }), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // --- Layout ---
  // Starts on "cards" so the server render and the first client render agree,
  // then the effect corrects it from storage — same reasoning as the theme.
  const [view, setView] = useState<View>("cards");
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    } catch {
      // Storage unavailable; fall through to the default.
    }
    if (stored === "list" || stored === "cards") setView(stored);
    else if (data.tabTotal > LIST_BY_DEFAULT_ABOVE) setView("list");
    // Only on arrival: switching tabs should not flip a layout under someone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function chooseView(next: View) {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Still applied for this visit.
    }
  }

  const [filtersOpen, setFiltersOpen] = useState(false);

  // --- Stars, optimistic over what the page arrived with ---
  const [starOverride, setStarOverride] = useState<Map<string, boolean>>(new Map());
  useEffect(() => setStarOverride(new Map()), [data]);
  const isFavorite = (r: RecipeListRow) => starOverride.get(r.id) ?? r.isFavorite;

  async function toggleFavorite(recipe: RecipeListRow) {
    const next = !isFavorite(recipe);
    const apply = (on: boolean) => setStarOverride((prev) => new Map(prev).set(recipe.id, on));
    apply(next);
    const res = await fetch(`/api/recipes/${recipe.id}/favorite`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorite: next }),
    });
    if (!res.ok) {
      apply(!next);
      setNotice({ variant: "danger", text: "Could not save that star." });
    }
  }

  // --- Selection ---
  // Either ticked recipes on this page, or every recipe matching the query.
  // Any change of query or page empties it: a bulk action must never reach a
  // recipe the person cannot see, and "12 selected" must always be the 12 they
  // are looking at. Crossing pages is what "select all matching" is for.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const queryKey = recipeQueryToParams(query).toString();
  useEffect(() => {
    setSelected(new Set());
    setAllMatching(false);
  }, [queryKey]);
  useEffect(() => {
    // After a delete, drop ids that are gone from the page.
    const present = new Set(data.rows.map((r) => r.id));
    setSelected((prev) => {
      const kept = [...prev].filter((id) => present.has(id));
      return kept.length === prev.size ? prev : new Set(kept);
    });
  }, [data]);

  const [request, setRequest] = useState<BulkRequest | null>(null);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [notice, setNotice] = useState<{ variant: string; text: string } | null>(null);

  const rows = data.rows;
  const pageAllSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = selected.size > 0 && !pageAllSelected;
  const selectionCount = allMatching ? data.total : selected.size;

  /** The query without paging, as the bulk endpoint's `matching`. */
  const matchingQuery = recipeQueryToParams({ ...query, page: 1, limit: PAGE_SIZE }).toString();
  const selection: { ids: string[]; matching?: undefined } | { ids?: undefined; matching: string } =
    allMatching ? { matching: matchingQuery } : { ids: [...selected] };

  function canEdit(recipe: RecipeListRow): boolean {
    if (recipe.visibility === "shared") return isAdmin;
    return recipe.ownerUserId === currentUserId;
  }

  /**
   * Where a recipe may be copied to, from this person's point of view. Only a
   * hint for which buttons to show — the server decides, and the confirmation
   * dialog shows what the server decided.
   */
  function copyTarget(recipe: RecipeListRow): "private" | "shared" | null {
    if (recipe.visibility === "shared") return "private";
    if (recipe.ownerUserId === currentUserId && isAdmin) return "shared";
    return null;
  }

  const bulkCopyTarget: "private" | "shared" | null =
    query.tab === "shared" ? "private" : isAdmin ? "shared" : null;
  const anyDeletable = allMatching
    ? query.tab === "mine" || isAdmin
    : rows.some((r) => selected.has(r.id) && canEdit(r));

  /** Tags on the selection with counts, for the Remove side of Tag…. */
  const selectionTags = useMemo(() => {
    if (allMatching) return data.facets.tags;
    const counts = new Map<string, { name: string; count: number }>();
    for (const r of rows) {
      if (!selected.has(r.id)) continue;
      for (const name of r.tags) {
        const entry = counts.get(tagKey(name)) ?? { name, count: 0 };
        entry.count += 1;
        counts.set(tagKey(name), entry);
      }
    }
    return [...counts.values()];
  }, [allMatching, data.facets.tags, rows, selected]);

  function handleDone(summary: BulkSummary, done: BulkRequest) {
    setRequest(null);
    setSelected(new Set());
    setAllMatching(false);
    const leftAlone = summary.skipped + summary.failed;
    if (done.action === "delete") {
      setNotice({
        variant: "success",
        text:
          `Deleted ${plural(summary.ok, "recipe")}` +
          (summary.plannedMeals ? ` and ${plural(summary.plannedMeals, "planned meal")}` : "") +
          "." +
          (leftAlone > 0 ? ` ${leftAlone} left alone.` : ""),
      });
    } else if (done.action === "tag") {
      setNotice({
        variant: "success",
        text:
          `${done.mode === "add" ? "Added" : "Removed"} ${done.tags.join(", ")} ${done.mode === "add" ? "to" : "from"} ${plural(summary.ok, "recipe")}.` +
          (summary.newTags?.length ? ` New tag${summary.newTags.length === 1 ? "" : "s"}: ${summary.newTags.join(", ")}.` : "") +
          (leftAlone > 0 ? ` ${leftAlone} left alone.` : ""),
      });
    } else {
      const where = done.target === "private" ? "your Secret Stash" : "the House Jar";
      setNotice({
        variant: "success",
        text:
          `Copied ${plural(summary.ok, "recipe")} to ${where}.` +
          (leftAlone > 0
            ? ` ${leftAlone} ${leftAlone === 1 ? "was" : "were"} already there or could not be copied.`
            : ""),
      });
    }
    // The page's rows and counts come from the server; ask for them again.
    router.refresh();
  }

  const viewProps = {
    recipes: rows,
    selected,
    onToggle: (id: string) => {
      setAllMatching(false);
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    canEdit,
    copyTarget,
    isFavorite,
    onToggleFavorite: toggleFavorite,
    onCopy: (recipe: RecipeListRow, target: "private" | "shared") => {
      setNotice(null);
      setRequest({ action: "copy", ids: [recipe.id], target });
    },
    // A single delete is a selection of one, so it gets the same dialog —
    // including the planned-meals warning.
    onDelete: (recipe: RecipeListRow) => {
      setNotice(null);
      setRequest({ action: "delete", ids: [recipe.id] });
    },
  };

  const activeFilters =
    query.mealTypes.length + query.tags.length + (query.favoritesOnly ? 1 : 0) + (query.maxMinutes ? 1 : 0);
  const first = data.total === 0 ? 0 : (data.page - 1) * data.limit + 1;
  const last = Math.min(data.total, (data.page - 1) * data.limit + rows.length);
  const pageCount = Math.max(1, Math.ceil(data.total / data.limit));
  const canShowMore = view === "cards" && data.page === 1 && rows.length < data.total && data.limit < MAX_LIMIT;


  return (
    <div>
      <Nav
        variant="tabs"
        activeKey={query.tab}
        className="mb-3"
        onSelect={(k) => update({ tab: k === "mine" ? "mine" : "shared", tags: [], mealTypes: [] })}
      >
        <Nav.Item>
          <Nav.Link
            eventKey="shared"
            title="Recipes everyone in the household can see and plan from. Only admins can add or edit them."
          >
            The House Jar
          </Nav.Link>
        </Nav.Item>
        <Nav.Item>
          <Nav.Link
            eventKey="mine"
            title="Your own private recipes. Nobody else sees them, and only your private plan draws from them."
          >
            Secret Stash
          </Nav.Link>
        </Nav.Item>
      </Nav>

      <Row className="g-4">
        <Col md={3} xl={2} className="d-none d-md-block">
          <RecipeFilters query={query} facets={data.facets} onChange={update} />
        </Col>

        <Col xs={12} md={9} xl={10}>
          <Row className="align-items-start g-2 mb-3">
            <Col xs={12} lg={6}>
              <RecipeSearchBar
                query={search}
                onQueryChange={setSearch}
                fields={query.fields}
                onFieldsChange={(fields) => update({ fields })}
                placeholder="Search by name, tag, or ingredient..."
              />
            </Col>
            <Col xs={12} lg={6}>
              <div className="d-flex gap-2 justify-content-lg-end flex-wrap">
                <Button
                  variant="outline-secondary"
                  className="d-md-none"
                  onClick={() => setFiltersOpen(true)}
                >
                  Filters{activeFilters > 0 && <Badge bg="secondary" className="ms-1">{activeFilters}</Badge>}
                </Button>
                {/* A plain link, not a fetch-and-blob: a blob: URL never reaches
                    the Android shell's DownloadListener. */}
                <a
                  href="/api/recipes/export"
                  className="btn btn-outline-secondary"
                  title="Download the recipes you can see, in the shape the importer takes."
                >
                  Export
                </a>
                <Link href="/recipes/import" passHref legacyBehavior>
                  <Button as="a" variant="outline-secondary">
                    Import
                  </Button>
                </Link>
                {(query.tab === "mine" || isAdmin) && (
                  <Link href="/recipes/new" passHref legacyBehavior>
                    <Button as="a" variant="primary">
                      + Add Recipe
                    </Button>
                  </Link>
                )}
              </div>
            </Col>
          </Row>

          {notice && (
            <Alert variant={notice.variant} dismissible onClose={() => setNotice(null)}>
              {notice.text}
            </Alert>
          )}

          <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
            <span className="text-body-secondary small" aria-live="polite">
              {data.total === 0
                ? "No recipes"
                : data.total <= rows.length
                  ? plural(data.total, "recipe")
                  : `${first.toLocaleString()}–${last.toLocaleString()} of ${data.total.toLocaleString()} recipes`}
              {pending && " · updating…"}
            </span>
            <Form.Select
              size="sm"
              className="ms-auto w-auto"
              aria-label="Sort recipes"
              value={query.sort}
              onChange={(e) => update({ sort: e.target.value as RecipeSort })}
            >
              {RECIPE_SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Form.Select>
            <ButtonGroup size="sm" aria-label="Layout">
              <Button
                variant={view === "cards" ? "secondary" : "outline-secondary"}
                aria-pressed={view === "cards"}
                onClick={() => chooseView("cards")}
              >
                Tiles
              </Button>
              <Button
                variant={view === "list" ? "secondary" : "outline-secondary"}
                aria-pressed={view === "list"}
                onClick={() => chooseView("list")}
              >
                List
              </Button>
            </ButtonGroup>
          </div>

          {rows.length > 0 && (
            <div className="pickl-bulk-bar d-flex flex-wrap align-items-center gap-2 mb-3">
              <Form.Check
                type="checkbox"
                id="select-all-recipes"
                className="mb-0 me-1"
                checked={pageAllSelected}
                // Indeterminate is a DOM property with no attribute.
                ref={(el: HTMLInputElement | null) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={() => {
                  setAllMatching(false);
                  setSelected(pageAllSelected ? new Set() : new Set(rows.map((r) => r.id)));
                }}
                label={
                  selectionCount === 0
                    ? rows.length < data.total
                      ? `Select all ${rows.length} on this page`
                      : `Select all ${rows.length}`
                    : `${selectionCount.toLocaleString()} selected`
                }
              />

              {/* The Gmail pattern: the page first, then an offer to widen. */}
              {pageAllSelected && !allMatching && data.total > rows.length && (
                <Button size="sm" variant="link" className="p-0" onClick={() => setAllMatching(true)}>
                  Select all {data.total.toLocaleString()} matching
                </Button>
              )}
              {allMatching && (
                <span className="small text-body-secondary">
                  Every recipe matching this search and these filters, on every page.
                </span>
              )}

              {selectionCount > 0 && (
                <>
                  {bulkCopyTarget && (
                    <Button
                      size="sm"
                      variant="outline-secondary"
                      onClick={() => {
                        setNotice(null);
                        setRequest({ action: "copy", target: bulkCopyTarget, ...selection });
                      }}
                    >
                      {bulkCopyTarget === "private" ? "Copy to my Secret Stash" : "Copy to the House Jar"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    onClick={() => {
                      setNotice(null);
                      setTagPickerOpen(true);
                    }}
                  >
                    Tag…
                  </Button>
                  {anyDeletable && (
                    <Button
                      size="sm"
                      variant="outline-danger"
                      onClick={() => {
                        setNotice(null);
                        setRequest({ action: "delete", ...selection });
                      }}
                    >
                      Delete
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="link"
                    onClick={() => {
                      setSelected(new Set());
                      setAllMatching(false);
                    }}
                  >
                    Clear
                  </Button>
                </>
              )}
            </div>
          )}

          {data.tabTotal === 0 ? (
            <p className="text-muted">
              {query.tab === "shared"
                ? "This jar's empty. Add a shared recipe to start filling it."
                : "Your own jar's empty. Add a private recipe only you can see."}
            </p>
          ) : data.total === 0 ? (
            <p className="text-muted">
              Nothing in the jar matches{query.q.trim() ? " that search" : ""}
              {activeFilters > 0 ? " with these filters" : ""}.{" "}
              <Button
                variant="link"
                className="p-0 align-baseline"
                onClick={() => {
                  setSearch("");
                  update({ q: "", mealTypes: [], tags: [], favoritesOnly: false, maxMinutes: null });
                }}
              >
                Show everything
              </Button>
            </p>
          ) : (
            <div style={{ opacity: pending ? 0.6 : 1, transition: "opacity 120ms" }}>
              {view === "cards" ? <RecipeCards {...viewProps} /> : <RecipeTable {...viewProps} />}
            </div>
          )}

          {canShowMore ? (
            <div className="text-center my-4">
              <Button
                variant="outline-secondary"
                disabled={pending}
                onClick={() => update({ limit: Math.min(MAX_LIMIT, data.limit + PAGE_SIZE) })}
              >
                Show {Math.min(PAGE_SIZE, data.total - rows.length)} more
              </Button>
            </div>
          ) : (
            pageCount > 1 && (
              <Pages
                page={data.page}
                count={pageCount}
                onGo={(page) => {
                  update({ page, limit: data.limit });
                  window.scrollTo({ top: 0 });
                }}
              />
            )
          )}
        </Col>
      </Row>

      <Offcanvas show={filtersOpen} onHide={() => setFiltersOpen(false)} placement="start">
        <Offcanvas.Header closeButton>
          <Offcanvas.Title as="h2" className="h5">
            Filter recipes
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          <RecipeFilters idPrefix="drawer-filter" query={query} facets={data.facets} onChange={update} />
          <Button className="w-100 mt-3" onClick={() => setFiltersOpen(false)}>
            Show {plural(data.total, "recipe")}
          </Button>
        </Offcanvas.Body>
      </Offcanvas>

      <RecipeTagPicker
        show={tagPickerOpen}
        count={selectionCount}
        present={selectionTags}
        suggestions={existingTags}
        onCancel={() => setTagPickerOpen(false)}
        onContinue={(mode, tags) => {
          setTagPickerOpen(false);
          setRequest({ action: "tag", tags, mode, ...selection });
        }}
      />

      <RecipeBulkConfirm request={request} onClose={() => setRequest(null)} onDone={handleDone} />
    </div>
  );
}

/** Numbered pages: first, last, and two either side of the current one. */
function Pages({ page, count, onGo }: { page: number; count: number; onGo: (page: number) => void }) {
  const shown = [...new Set([1, page - 2, page - 1, page, page + 1, page + 2, count])]
    .filter((p) => p >= 1 && p <= count)
    .sort((a, b) => a - b);
  return (
    <Pagination className="justify-content-center my-4 flex-wrap" aria-label="Recipe pages">
      <Pagination.Prev disabled={page === 1} onClick={() => onGo(page - 1)} aria-label="Previous page" />
      {shown.map((p, i) => (
        <Fragment key={p}>
          {i > 0 && p - shown[i - 1] > 1 && <Pagination.Ellipsis disabled />}
          <Pagination.Item active={p === page} onClick={() => onGo(p)} aria-label={`Page ${p}`}>
            {p}
          </Pagination.Item>
        </Fragment>
      ))}
      <Pagination.Next disabled={page === count} onClick={() => onGo(page + 1)} aria-label="Next page" />
    </Pagination>
  );
}

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}
