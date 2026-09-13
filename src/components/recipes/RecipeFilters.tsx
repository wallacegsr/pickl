"use client";

import { useState } from "react";
import { Button, ButtonGroup, Form } from "react-bootstrap";
import type { RecipeFacets, RecipeQuery } from "@/lib/recipeQueryParams";
import { tagKey } from "@/lib/tagNames";

const MEAL_LABELS: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  dessert: "Dessert",
  any: "Any meal",
};

/** Tags shown before "Show all". Enough to cover most households' favourites. */
const TAGS_SHOWN = 12;
const QUICK_MINUTES = 30;

/**
 * The filter sidebar: meal type, favourites, quick, and tags — each with how
 * many of the current results it would leave.
 *
 * Purely controlled. Every change becomes a new URL (see RecipeList), so a
 * filtered view survives a refresh, the back button, and being shared.
 */
export default function RecipeFilters({
  query,
  facets,
  onChange,
  idPrefix = "filter",
}: {
  /**
   * Namespace for checkbox ids. The sidebar and the phone's filter drawer can
   * both be in the page, and duplicate ids would point each label at the
   * wrong copy.
   */
  idPrefix?: string;
  query: RecipeQuery;
  facets: RecipeFacets;
  onChange: (patch: Partial<RecipeQuery>) => void;
}) {
  const [tagFilter, setTagFilter] = useState("");
  const [showAllTags, setShowAllTags] = useState(false);

  const selectedKeys = new Set(query.tags.map(tagKey));
  const needle = tagFilter.trim().toLowerCase();
  const matchingTags = facets.tags.filter((t) => !needle || t.name.toLowerCase().includes(needle));
  // Ticked tags always show, wherever their count would rank them.
  const visibleTags =
    showAllTags || needle
      ? matchingTags
      : [
          ...matchingTags.filter((t) => selectedKeys.has(tagKey(t.name))),
          ...matchingTags.filter((t) => !selectedKeys.has(tagKey(t.name))).slice(0, TAGS_SHOWN),
        ];

  const activeCount =
    query.mealTypes.length + query.tags.length + (query.favoritesOnly ? 1 : 0) + (query.maxMinutes ? 1 : 0);

  function toggleMeal(value: string) {
    onChange({
      mealTypes: query.mealTypes.includes(value)
        ? query.mealTypes.filter((m) => m !== value)
        : [...query.mealTypes, value],
    });
  }

  function toggleTag(name: string) {
    const key = tagKey(name);
    onChange({
      tags: selectedKeys.has(key) ? query.tags.filter((t) => tagKey(t) !== key) : [...query.tags, name],
    });
  }

  return (
    <div className="pickl-recipe-filters small">
      <div className="d-flex justify-content-between align-items-baseline mb-2">
        <h3 className="h6 mb-0">Filters</h3>
        {activeCount > 0 && (
          <Button
            variant="link"
            size="sm"
            className="p-0"
            onClick={() => onChange({ mealTypes: [], tags: [], favoritesOnly: false, maxMinutes: null })}
          >
            Clear all
          </Button>
        )}
      </div>

      <fieldset className="mb-3">
        <legend className="fs-6 fw-semibold mb-1">Show only</legend>
        <FacetCheck
          id={`${idPrefix}-favorites`}
          label="★ My favorites"
          count={facets.favorites}
          checked={query.favoritesOnly}
          onChange={() => onChange({ favoritesOnly: !query.favoritesOnly })}
        />
        <FacetCheck
          id={`${idPrefix}-quick`}
          label={`Ready in ${QUICK_MINUTES} min or less`}
          title="Prep and cook time together. Recipes with no times recorded are left out."
          checked={query.maxMinutes !== null}
          onChange={() => onChange({ maxMinutes: query.maxMinutes ? null : QUICK_MINUTES })}
        />
      </fieldset>

      <fieldset className="mb-3">
        <legend className="fs-6 fw-semibold mb-1">Meal</legend>
        {facets.mealTypes.map((m) => (
          <FacetCheck
            key={m.value}
            id={`${idPrefix}-meal-${m.value}`}
            label={MEAL_LABELS[m.value] ?? m.value}
            count={m.count}
            checked={query.mealTypes.includes(m.value)}
            onChange={() => toggleMeal(m.value)}
          />
        ))}
      </fieldset>

      <fieldset>
        <legend className="fs-6 fw-semibold mb-1">Tags</legend>
        {query.tags.length >= 2 && (
          <ButtonGroup size="sm" className="mb-2" aria-label="How tags combine">
            <Button
              variant={query.tagMatch === "all" ? "secondary" : "outline-secondary"}
              aria-pressed={query.tagMatch === "all"}
              title="Recipes carrying every ticked tag"
              onClick={() => onChange({ tagMatch: "all" })}
            >
              All
            </Button>
            <Button
              variant={query.tagMatch === "any" ? "secondary" : "outline-secondary"}
              aria-pressed={query.tagMatch === "any"}
              title="Recipes carrying at least one ticked tag"
              onClick={() => onChange({ tagMatch: "any" })}
            >
              Any
            </Button>
          </ButtonGroup>
        )}
        {facets.tags.length > TAGS_SHOWN && (
          <Form.Control
            size="sm"
            className="mb-2"
            placeholder="Find a tag…"
            aria-label="Find a tag"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
          />
        )}
        {visibleTags.map((t) => (
          <FacetCheck
            key={tagKey(t.name)}
            id={`${idPrefix}-tag-${tagKey(t.name)}`}
            label={t.name}
            count={t.count}
            checked={selectedKeys.has(tagKey(t.name))}
            onChange={() => toggleTag(t.name)}
          />
        ))}
        {facets.tags.length === 0 && <p className="text-muted mb-0">No tags on these recipes.</p>}
        {!needle && matchingTags.length > visibleTags.length && (
          <Button variant="link" size="sm" className="p-0" onClick={() => setShowAllTags(true)}>
            Show all {matchingTags.length} tags
          </Button>
        )}
        {!needle && showAllTags && matchingTags.length > TAGS_SHOWN && (
          <Button variant="link" size="sm" className="p-0" onClick={() => setShowAllTags(false)}>
            Show fewer
          </Button>
        )}
      </fieldset>
    </div>
  );
}

function FacetCheck({
  id,
  label,
  count,
  checked,
  onChange,
  title,
}: {
  id: string;
  label: string;
  count?: number;
  checked: boolean;
  onChange: () => void;
  title?: string;
}) {
  return (
    <Form.Check
      type="checkbox"
      id={id}
      checked={checked}
      onChange={onChange}
      title={title}
      // A zero only matters when it is ticked (so it can be unticked); dimmed
      // otherwise, since ticking it would empty the list.
      className={count === 0 && !checked ? "text-body-secondary" : undefined}
      label={
        <>
          {label}
          {count !== undefined && <span className="text-body-secondary"> ({count})</span>}
        </>
      }
    />
  );
}
