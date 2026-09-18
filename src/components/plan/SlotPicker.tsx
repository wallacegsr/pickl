"use client";

import { useEffect, useMemo, useState } from "react";
import { Form } from "react-bootstrap";
import Sheet from "@/components/ui/Sheet";
import ListRow, { ListRows, ListSection } from "@/components/ui/ListRow";
import Chip, { ChipRow } from "@/components/ui/Chip";
import { matchesRecipeSearch } from "@/lib/recipeSearch";
import { tagKey } from "@/lib/tagNames";
import type { RecipeOption } from "@/components/PlanView";

/** Rows drawn before "search to narrow it down" takes over. */
const MAX_ROWS = 60;
/** How many of each kind of suggestion to offer on an empty search. */
const SUGGESTIONS = 6;
/** The chip that means "ready in 30 minutes or less". */
const QUICK_MINUTES = 30;

export interface SlotPickerChips {
  /** Tag names to offer as chips, in order. */
  tags: string[];
  /** Whether these came from the person's own choice or the default set. */
  custom: boolean;
}

/**
 * Choosing what goes in one meal slot.
 *
 * A sheet, not a form: search at the top, a list of recipes, a tick on the
 * ones chosen, Save. Tapping a row adds or removes it, so a slot holding two
 * recipes is the same gesture done twice.
 *
 * Before anything is typed it offers suggestions rather than the alphabet —
 * your favourites, then things you haven't cooked in a while — because "what
 * shall we have" is the actual question, and the answer is rarely the recipe
 * whose name starts with a number.
 *
 * Everything here filters the pool the page already loaded; it makes no
 * request of its own, and saving is still PlanView's job.
 */
export default function SlotPicker({
  show,
  title,
  subtitle,
  pool,
  selectedIds,
  chips,
  saving,
  onChange,
  onSave,
  onCancel,
}: {
  show: boolean;
  title: string;
  subtitle: string;
  pool: RecipeOption[];
  selectedIds: string[];
  chips: SlotPickerChips;
  saving: boolean;
  onChange: (ids: string[]) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [search, setSearch] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [quickOnly, setQuickOnly] = useState(false);
  const [tagOn, setTagOn] = useState<string[]>([]);

  // Fresh each time it opens: last night's search is not this slot's question.
  useEffect(() => {
    if (show) {
      setSearch("");
      setFavoritesOnly(false);
      setQuickOnly(false);
      setTagOn([]);
    }
  }, [show]);

  const byId = useMemo(() => new Map(pool.map((r) => [r.id, r])), [pool]);
  const chosen = selectedIds.map((id) => byId.get(id)).filter((r): r is RecipeOption => Boolean(r));

  const searching = search.trim().length > 0;
  const filtering = favoritesOnly || quickOnly || tagOn.length > 0;

  const matched = useMemo(() => {
    const keys = tagOn.map(tagKey);
    return pool.filter((r) => {
      if (favoritesOnly && !r.isFavorite) return false;
      if (quickOnly && (r.totalMinutes == null || r.totalMinutes > QUICK_MINUTES)) return false;
      if (keys.length > 0 && !keys.every((k) => r.tags.some((t) => tagKey(t) === k))) return false;
      return matchesRecipeSearch(r, search, { name: true, tags: true, ingredients: true });
    });
  }, [pool, search, favoritesOnly, quickOnly, tagOn]);

  /** Chosen recipes are never hidden by a search — they must stay removable. */
  const results = matched.filter((r) => !selectedIds.includes(r.id));

  const favorites = useMemo(
    () => results.filter((r) => r.isFavorite).slice(0, SUGGESTIONS),
    [results]
  );
  const neglected = useMemo(() => {
    const seen = new Set(favorites.map((r) => r.id));
    return [...results]
      .filter((r) => !seen.has(r.id))
      // Never planned first, then longest ago.
      .sort((a, b) => (a.lastPlanned ?? "").localeCompare(b.lastPlanned ?? ""))
      .slice(0, SUGGESTIONS);
  }, [results, favorites]);

  const showSuggestions = !searching && !filtering && (favorites.length > 0 || neglected.length > 0);
  const suggested = new Set([...favorites, ...neglected].map((r) => r.id));
  const rest = showSuggestions ? results.filter((r) => !suggested.has(r.id)) : results;
  const shown = rest.slice(0, MAX_ROWS);

  function toggle(id: string) {
    onChange(
      selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]
    );
  }

  const row = (recipe: RecipeOption, selected: boolean) => (
    <ListRow
      key={recipe.id}
      title={recipe.name}
      meta={describe(recipe)}
      selected={selected}
      onClick={() => toggle(recipe.id)}
    />
  );

  return (
    <Sheet
      show={show}
      title={title}
      subtitle={subtitle}
      onClose={onCancel}
      onAction={onSave}
      busy={saving}
      footerNote={
        selectedIds.length > 0 ? (
          <>
            Tap a recipe to add or remove ·{" "}
            <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={() => onChange([])}>
              Clear
            </button>
          </>
        ) : (
          "Tap a recipe to add it. Saving with none chosen empties the slot."
        )
      }
      toolbar={
        <>
          <Form.Control
            type="search"
            className="mb-2"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recipes"
            aria-label="Search recipes by name, tag or ingredient"
          />
          <ChipRow label="Narrow the list">
            <Chip
              label="★ Favorites"
              active={favoritesOnly}
              onClick={() => setFavoritesOnly(!favoritesOnly)}
              title="Only recipes you have starred"
            />
            <Chip
              label="Quick"
              active={quickOnly}
              onClick={() => setQuickOnly(!quickOnly)}
              title={`Prep and cook together, ${QUICK_MINUTES} minutes or less`}
            />
            {chips.tags.map((tag) => (
              <Chip
                key={tag}
                label={tag}
                active={tagOn.includes(tag)}
                onClick={() =>
                  setTagOn(tagOn.includes(tag) ? tagOn.filter((t) => t !== tag) : [...tagOn, tag])
                }
              />
            ))}
          </ChipRow>
        </>
      }
    >
      {chosen.length > 0 && (
        <>
          <ListSection>Chosen</ListSection>
          <ListRows label="Chosen recipes">{chosen.map((r) => row(r, true))}</ListRows>
        </>
      )}

      {showSuggestions && favorites.length > 0 && (
        <>
          <ListSection>Your favorites</ListSection>
          <ListRows label="Favorites">{favorites.map((r) => row(r, false))}</ListRows>
        </>
      )}

      {showSuggestions && neglected.length > 0 && (
        <>
          <ListSection>Not cooked lately</ListSection>
          <ListRows label="Not cooked lately">{neglected.map((r) => row(r, false))}</ListRows>
        </>
      )}

      {shown.length > 0 && (
        <>
          <ListSection>
            {searching || filtering
              ? `${matched.length} of ${pool.length}`
              : showSuggestions
                ? "Everything else"
                : "All recipes"}
          </ListSection>
          <ListRows label="Recipes">{shown.map((r) => row(r, false))}</ListRows>
        </>
      )}

      {rest.length > shown.length && (
        <p className="pickl-sheet-note mb-0 py-3">
          {rest.length - shown.length} more — search to narrow it down.
        </p>
      )}

      {matched.length === 0 && (
        <p className="pickl-sheet-note mb-0 py-4">
          Nothing here matches. Clear the search or the filters to see all {pool.length}.
        </p>
      )}
    </Sheet>
  );
}

/**
 * The quiet line under a recipe's name: when it was last cooked, how long it
 * takes, and its tags — whichever of those it actually has, in that order,
 * because the first two are what decides a weeknight.
 */
function describe(recipe: RecipeOption): string {
  const parts: string[] = [];
  if (recipe.lastPlanned === null) parts.push("Never cooked");
  else if (recipe.lastPlanned) parts.push(`Last ${recipe.lastPlanned}`);
  if (recipe.totalMinutes != null) parts.push(`${recipe.totalMinutes} min`);
  parts.push(...recipe.tags);
  return parts.join(" · ");
}
