"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Button, ButtonGroup, Col, Form, Nav, Row } from "react-bootstrap";
import { useRouter } from "next/navigation";
import type { RecipeWithTags } from "@/db/schema";
import RecipeSearchBar from "@/components/RecipeSearchBar";
import {
  DEFAULT_RECIPE_SEARCH_FIELDS,
  matchesRecipeSearch,
  type RecipeSearchFields,
} from "@/lib/recipeSearch";
import { RecipeCards, RecipeTable } from "@/components/recipes/recipeViews";
import RecipeBulkConfirm, { type BulkRequest } from "@/components/recipes/RecipeBulkConfirm";
import type { BulkSummary } from "@/lib/recipeBulk";

type Tab = "shared" | "mine";
type View = "cards" | "list";

/**
 * Per device, like the sidebar's collapsed state: how someone likes a list
 * laid out is a property of the screen they are looking at, not of their
 * account. A phone and a desktop can each keep their own.
 */
const VIEW_STORAGE_KEY = "pickl-recipe-view-v1";

export default function RecipeList({
  initialRecipes,
  currentUserId,
  isAdmin,
  initialTagFilter,
}: {
  initialRecipes: RecipeWithTags[];
  currentUserId: string;
  isAdmin: boolean;
  /**
   * A tag to filter by on arrival, from `?tag=` — the Tags page links its
   * recipe counts here. Search is narrowed to tags only, so following the "3"
   * beside "Quick" shows those three rather than every recipe whose name or
   * ingredients happen to contain the word.
   */
  initialTagFilter?: string;
}) {
  const router = useRouter();
  const [recipes, setRecipes] = useState(initialRecipes);
  const [tab, setTab] = useState<Tab>("shared");
  const [search, setSearch] = useState(initialTagFilter ?? "");
  // Narrowed to tags when arriving from the Tags page: the count that was
  // clicked counts tagged recipes, so the list it opens has to mean the same
  // thing, or the number and the result would disagree.
  const [searchFields, setSearchFields] = useState<RecipeSearchFields>(
    initialTagFilter
      ? { name: false, tags: true, ingredients: false }
      : DEFAULT_RECIPE_SEARCH_FIELDS
  );

  // Starts on "cards" so the server render and the first client render agree,
  // then the effect corrects it from storage — same reasoning as the theme.
  const [view, setView] = useState<View>("cards");
  useEffect(() => {
    try {
      if (window.localStorage.getItem(VIEW_STORAGE_KEY) === "list") setView("list");
    } catch {
      // Storage unavailable; tiles it is.
    }
  }, []);
  function chooseView(next: View) {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Still applied for this visit.
    }
  }

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [request, setRequest] = useState<BulkRequest | null>(null);
  const [notice, setNotice] = useState<{ variant: string; text: string } | null>(null);

  // Keep the server's latest list when it re-renders after an action.
  useEffect(() => {
    setRecipes(initialRecipes);
  }, [initialRecipes]);

  function canEdit(recipe: RecipeWithTags): boolean {
    if (recipe.visibility === "shared") return isAdmin;
    return recipe.ownerUserId === currentUserId;
  }

  /**
   * Where a recipe may be copied to, from this person's point of view. Only a
   * hint for which buttons to show — the server decides, and the confirmation
   * dialog shows what the server decided.
   *
   *   - A House Jar recipe can go to anyone's own stash.
   *   - Your own stash recipe can go to the House Jar if you are an admin.
   */
  function copyTarget(recipe: RecipeWithTags): "private" | "shared" | null {
    if (recipe.visibility === "shared") return "private";
    if (recipe.ownerUserId === currentUserId && isAdmin) return "shared";
    return null;
  }

  const tabRecipes = useMemo(
    () =>
      recipes.filter((r) =>
        tab === "shared" ? r.visibility === "shared" : r.ownerUserId === currentUserId
      ),
    [recipes, tab, currentUserId]
  );

  const filtered = useMemo(
    () => tabRecipes.filter((r) => matchesRecipeSearch(r, search, searchFields)),
    [tabRecipes, search, searchFields]
  );

  // A selection only ever holds recipes currently on screen. Switching tab
  // empties it; narrowing the search drops whatever the search hid. The rule
  // is blunt on purpose: Delete must never reach a recipe the person cannot
  // see, and "12 selected" must always be the 12 they are looking at.
  useEffect(() => {
    setSelected(new Set());
  }, [tab]);
  useEffect(() => {
    setSelected((prev) => {
      const visible = new Set(filtered.map((r) => r.id));
      const kept = [...prev].filter((id) => visible.has(id));
      return kept.length === prev.size ? prev : new Set(kept);
    });
  }, [filtered]);

  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const someSelected = selected.size > 0 && !allSelected;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(filtered.map((r) => r.id)));
  }

  // The bulk bar's copy button follows the tab: House Jar recipes go to your
  // stash; stash recipes go to the jar, and only for an admin.
  const bulkCopyTarget: "private" | "shared" | null =
    tab === "shared" ? "private" : isAdmin ? "shared" : null;
  const selectedIds = [...selected];
  const anyDeletable = filtered.some((r) => selected.has(r.id) && canEdit(r));

  function handleDone(summary: BulkSummary, done: BulkRequest) {
    setRequest(null);
    if (done.action === "delete") {
      const gone = new Set(summary.rows.filter((r) => r.status === "ok").map((r) => r.id));
      setRecipes((prev) => prev.filter((r) => !gone.has(r.id)));
      setSelected((prev) => new Set([...prev].filter((id) => !gone.has(id))));
      setNotice({
        variant: "success",
        text:
          `Deleted ${summary.ok} recipe${summary.ok === 1 ? "" : "s"}` +
          (summary.plannedMeals ? ` and ${summary.plannedMeals} planned meal${summary.plannedMeals === 1 ? "" : "s"}` : "") +
          "." +
          (summary.skipped + summary.failed > 0
            ? ` ${summary.skipped + summary.failed} left alone.`
            : ""),
      });
    } else {
      setSelected(new Set());
      const where = done.target === "private" ? "your Secret Stash" : "the House Jar";
      setNotice({
        variant: "success",
        text:
          `Copied ${summary.ok} recipe${summary.ok === 1 ? "" : "s"} to ${where}.` +
          (summary.skipped + summary.failed > 0
            ? ` ${summary.skipped + summary.failed} ${summary.skipped + summary.failed === 1 ? "was" : "were"} already there or could not be copied.`
            : ""),
      });
    }
    // Copies exist only on the server until it re-renders the list.
    router.refresh();
  }

  const viewProps = {
    recipes: filtered,
    selected,
    onToggle: toggle,
    canEdit,
    copyTarget,
    onCopy: (recipe: RecipeWithTags, target: "private" | "shared") => {
      setNotice(null);
      setRequest({ action: "copy", ids: [recipe.id], target });
    },
    // A single delete is a selection of one, so it gets the same dialog —
    // including the planned-meals warning the old single-recipe one lacked.
    onDelete: (recipe: RecipeWithTags) => {
      setNotice(null);
      setRequest({ action: "delete", ids: [recipe.id] });
    },
  };

  return (
    <div>
      <Nav
        variant="tabs"
        activeKey={tab}
        className="mb-3"
        onSelect={(k) => setTab((k as Tab) ?? "shared")}
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

      <Row className="align-items-center mb-3">
        <Col xs={12} md={6}>
          <RecipeSearchBar
            query={search}
            onQueryChange={setSearch}
            fields={searchFields}
            onFieldsChange={setSearchFields}
            placeholder="Search by name, tag, or ingredient..."
          />
        </Col>
        <Col xs={12} md={6} className="text-md-end mt-2 mt-md-0">
          <div className="d-flex gap-2 justify-content-md-end flex-wrap">
            {/* A plain link, not a fetch-and-blob: a blob: URL never reaches
                the Android shell's DownloadListener, so the in-browser version
                of this would silently do nothing inside the app. Same
                reasoning as the shopping-list export. */}
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
            {(tab === "mine" || isAdmin) && (
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

      {filtered.length > 0 && (
        <div className="pickl-bulk-bar d-flex flex-wrap align-items-center gap-2 mb-3">
          <Form.Check
            type="checkbox"
            id="select-all-recipes"
            className="mb-0 me-1"
            checked={allSelected}
            // Indeterminate is a DOM property with no attribute, so it has to
            // be set on the element itself.
            ref={(el: HTMLInputElement | null) => {
              if (el) el.indeterminate = someSelected;
            }}
            onChange={toggleAll}
            label={
              selected.size === 0
                ? `Select all ${filtered.length}`
                : `${selected.size} of ${filtered.length} selected`
            }
          />

          {selected.size > 0 && (
            <>
              {bulkCopyTarget && (
                <Button
                  size="sm"
                  variant="outline-secondary"
                  onClick={() => {
                    setNotice(null);
                    setRequest({ action: "copy", ids: selectedIds, target: bulkCopyTarget });
                  }}
                >
                  {bulkCopyTarget === "private" ? "Copy to my Secret Stash" : "Copy to the House Jar"}
                </Button>
              )}
              {anyDeletable && (
                <Button
                  size="sm"
                  variant="outline-danger"
                  onClick={() => {
                    setNotice(null);
                    setRequest({ action: "delete", ids: selectedIds });
                  }}
                >
                  Delete
                </Button>
              )}
              <Button size="sm" variant="link" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </>
          )}

          <ButtonGroup size="sm" className="ms-auto" aria-label="Layout">
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
      )}

      {filtered.length === 0 && (
        <p className="text-muted">
          {search.trim()
            ? "Nothing in the jar matches that search."
            : tab === "shared"
              ? "This jar's empty. Add a shared recipe to start filling it."
              : "Your own jar's empty. Add a private recipe only you can see."}
        </p>
      )}

      {filtered.length > 0 &&
        (view === "cards" ? <RecipeCards {...viewProps} /> : <RecipeTable {...viewProps} />)}

      <RecipeBulkConfirm
        request={request}
        onClose={() => setRequest(null)}
        onDone={handleDone}
      />
    </div>
  );
}
