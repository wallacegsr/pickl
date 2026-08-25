"use client";

import { Form } from "react-bootstrap";
import type { RecipeSearchFields } from "@/lib/recipeSearch";

/** Search box + "search in: name / tag / ingredients" checkboxes, shared by the recipe list and the plan page's manual recipe picker. */
export default function RecipeSearchBar({
  query,
  onQueryChange,
  fields,
  onFieldsChange,
  placeholder = "Search recipes...",
  size,
  idPrefix = "recipe-search",
  controlId,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  fields: RecipeSearchFields;
  onFieldsChange: (fields: RecipeSearchFields) => void;
  placeholder?: string;
  size?: "sm";
  /**
   * Namespace for the three checkbox ids. Since the dashboard can show the
   * quick-look widget and the slot-editor modal at the same time, two of
   * these can be mounted together — and duplicate ids would make each
   * checkbox's label point at whichever copy rendered first. Defaults to the
   * original value so existing call sites keep their ids.
   */
  idPrefix?: string;
  /** id for the text input itself, when an external <label> points at it. */
  controlId?: string;
}) {
  function toggle(field: keyof RecipeSearchFields) {
    onFieldsChange({ ...fields, [field]: !fields[field] });
  }

  return (
    <div>
      <Form.Control
        id={controlId}
        size={size}
        placeholder={placeholder}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      <div className="d-flex flex-wrap gap-3 mt-1">
        <Form.Check
          type="checkbox"
          id={`${idPrefix}-field-name`}
          label="Name"
          checked={fields.name}
          onChange={() => toggle("name")}
          inline
        />
        <Form.Check
          type="checkbox"
          id={`${idPrefix}-field-tags`}
          label="Tag"
          checked={fields.tags}
          onChange={() => toggle("tags")}
          inline
        />
        <Form.Check
          type="checkbox"
          id={`${idPrefix}-field-ingredients`}
          label="Ingredients"
          checked={fields.ingredients}
          onChange={() => toggle("ingredients")}
          inline
        />
      </div>
    </div>
  );
}
