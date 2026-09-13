"use client";

import Link from "next/link";
import { Badge, Button, Card, Col, Form, Row } from "react-bootstrap";
import type { RecipeWithTags } from "@/db/schema";
import {
  StackedBody,
  StackedCell,
  StackedHead,
  StackedHeader,
  StackedRow,
  StackedTable,
} from "@/components/reports/StackedTable";

/**
 * The two ways the recipe list can be laid out — tiles and a table — taking
 * one set of props, so selecting, copying and deleting behave identically in
 * both. Switching view changes where things sit and nothing else.
 */
export interface RecipeViewProps {
  recipes: RecipeWithTags[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  canEdit: (recipe: RecipeWithTags) => boolean;
  /** Where this recipe may be copied, or null when it may not be copied. */
  copyTarget: (recipe: RecipeWithTags) => "private" | "shared" | null;
  onCopy: (recipe: RecipeWithTags, target: "private" | "shared") => void;
  onDelete: (recipe: RecipeWithTags) => void;
  /** The viewer's own star on this recipe. */
  isFavorite: (recipe: RecipeWithTags) => boolean;
  onToggleFavorite: (recipe: RecipeWithTags) => void;
}

/**
 * The star. A toggle button with aria-pressed, so it announces as "Favorite,
 * pressed" rather than as an unexplained glyph, and named after the recipe for
 * the same reason the checkboxes are.
 */
function Star({
  recipe,
  on,
  onToggle,
}: {
  recipe: RecipeWithTags;
  on: boolean;
  onToggle: (recipe: RecipeWithTags) => void;
}) {
  return (
    <button
      type="button"
      className="btn btn-link p-0 lh-1 text-decoration-none"
      style={{ fontSize: "1.25rem", color: on ? "var(--bs-warning)" : "var(--bs-secondary-color)" }}
      aria-pressed={on}
      aria-label={`Favorite ${recipe.name}`}
      title={on ? "Starred — click to unstar" : "Star this recipe"}
      onClick={() => onToggle(recipe)}
    >
      {on ? "★" : "☆"}
    </button>
  );
}

function mealTypesOf(recipe: RecipeWithTags): string[] {
  return recipe.mealType
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function copyLabel(target: "private" | "shared", short = false) {
  if (short) return target === "private" ? "Copy to stash" : "Copy to jar";
  return target === "private" ? "Copy to my Secret Stash" : "Copy to the House Jar";
}

/**
 * The checkbox for one recipe.
 *
 * Its accessible name is the recipe's, not "Select": a screen reader moving
 * through twenty checkboxes each announced as "Select, checkbox" tells nobody
 * which recipe they are about to delete.
 */
function SelectBox({
  recipe,
  checked,
  onToggle,
}: {
  recipe: RecipeWithTags;
  checked: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <Form.Check
      type="checkbox"
      id={`select-recipe-${recipe.id}`}
      checked={checked}
      onChange={() => onToggle(recipe.id)}
      aria-label={`Select ${recipe.name}`}
      className="mb-0"
    />
  );
}

function Actions({
  recipe,
  canEdit,
  copyTarget,
  onCopy,
  onDelete,
  compact,
}: {
  recipe: RecipeWithTags;
  canEdit: boolean;
  copyTarget: "private" | "shared" | null;
  onCopy: RecipeViewProps["onCopy"];
  onDelete: RecipeViewProps["onDelete"];
  compact?: boolean;
}) {
  if (!canEdit && !copyTarget) return null;
  return (
    <div className="d-flex flex-wrap gap-2">
      {canEdit && (
        <Link href={`/recipes/${recipe.id}/edit`} passHref legacyBehavior>
          <Button as="a" size="sm" variant="outline-primary">
            Edit
          </Button>
        </Link>
      )}
      {copyTarget && (
        <Button
          size="sm"
          variant="outline-secondary"
          onClick={() => onCopy(recipe, copyTarget)}
          title={copyLabel(copyTarget)}
        >
          {copyLabel(copyTarget, compact)}
        </Button>
      )}
      {canEdit && (
        <Button size="sm" variant="outline-danger" onClick={() => onDelete(recipe)}>
          Delete
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

export function RecipeCards(props: RecipeViewProps) {
  const { recipes, selected, onToggle, canEdit, copyTarget, onCopy, onDelete, isFavorite, onToggleFavorite } = props;

  return (
    <Row xs={1} md={2} lg={3} className="g-3">
      {recipes.map((recipe) => {
        const isSelected = selected.has(recipe.id);
        return (
          <Col key={recipe.id}>
            <Card
              className={`h-100 shadow-sm${isSelected ? " border-primary" : ""}`}
              // A visible ring as well as a ticked box: at a glance across a
              // grid of tiles, the box is too small to be the only signal.
              style={isSelected ? { boxShadow: "0 0 0 2px var(--bs-primary)" } : undefined}
            >
              <Card.Body className="d-flex flex-column">
                <div className="d-flex justify-content-between align-items-start gap-2">
                  <div className="d-flex align-items-start gap-2">
                    <div className="pt-1">
                      <SelectBox recipe={recipe} checked={isSelected} onToggle={onToggle} />
                    </div>
                    <Card.Title className="mb-0">{recipe.name}</Card.Title>
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    {recipe.visibility === "private" && (
                      <Badge bg="info" text="dark">
                        Private
                      </Badge>
                    )}
                    <Star recipe={recipe} on={isFavorite(recipe)} onToggle={onToggleFavorite} />
                  </div>
                </div>
                <div className="my-2 small text-muted">
                  {recipe.prepTimeMinutes != null && (
                    <span className="me-2">Prep: {recipe.prepTimeMinutes}m</span>
                  )}
                  {recipe.cookTimeMinutes != null && (
                    <span className="me-2">Cook: {recipe.cookTimeMinutes}m</span>
                  )}
                  {recipe.servings != null && <span>Serves: {recipe.servings}</span>}
                </div>
                <div className="mb-2">
                  {mealTypesOf(recipe).map((tag) => (
                    <Badge key={tag} bg="dark" className="recipe-tag-badge me-1">
                      {tag}
                    </Badge>
                  ))}
                  {recipe.tags.map((tag) => (
                    <Badge key={tag} bg="secondary" className="recipe-tag-badge">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <Card.Text
                  className="flex-grow-1"
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {recipe.instructions}
                </Card.Text>
                <div className="mt-2">
                  <Actions
                    recipe={recipe}
                    canEdit={canEdit(recipe)}
                    copyTarget={copyTarget(recipe)}
                    onCopy={onCopy}
                    onDelete={onDelete}
                  />
                </div>
              </Card.Body>
            </Card>
          </Col>
        );
      })}
    </Row>
  );
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/**
 * The table layout. Built on StackedTable, so on a phone each row becomes a
 * labelled card rather than a seven-column grid dragged sideways — the same
 * treatment the report tables already get.
 */
export function RecipeTable(props: RecipeViewProps) {
  const { recipes, selected, onToggle, canEdit, copyTarget, onCopy, onDelete, isFavorite, onToggleFavorite } = props;

  return (
    <StackedTable hover>
      <StackedHead>
        <StackedRow>
          <StackedHeader style={{ width: "2.5rem" }}>
            <span className="visually-hidden">Selected</span>
          </StackedHeader>
          <StackedHeader>Recipe</StackedHeader>
          <StackedHeader>Meals</StackedHeader>
          <StackedHeader>Tags</StackedHeader>
          <StackedHeader>Time</StackedHeader>
          <StackedHeader>Serves</StackedHeader>
          <StackedHeader className="text-end">Actions</StackedHeader>
        </StackedRow>
      </StackedHead>
      <StackedBody>
        {recipes.map((recipe) => {
          const time = [
            recipe.prepTimeMinutes != null ? `${recipe.prepTimeMinutes}m prep` : null,
            recipe.cookTimeMinutes != null ? `${recipe.cookTimeMinutes}m cook` : null,
          ]
            .filter(Boolean)
            .join(", ");
          return (
            <StackedRow
              key={recipe.id}
              className={selected.has(recipe.id) ? "table-active" : undefined}
            >
              <StackedCell label="Select">
                <SelectBox
                  recipe={recipe}
                  checked={selected.has(recipe.id)}
                  onToggle={onToggle}
                />
              </StackedCell>
              <StackedCell label="Recipe">
                <Star recipe={recipe} on={isFavorite(recipe)} onToggle={onToggleFavorite} />{" "}
                <span className="fw-semibold">{recipe.name}</span>
                {recipe.visibility === "private" && (
                  <Badge bg="info" text="dark" className="ms-2">
                    Private
                  </Badge>
                )}
              </StackedCell>
              <StackedCell label="Meals">
                {mealTypesOf(recipe).map((tag) => (
                  <Badge key={tag} bg="dark" className="recipe-tag-badge me-1">
                    {tag}
                  </Badge>
                ))}
              </StackedCell>
              <StackedCell label="Tags">
                {recipe.tags.length ? (
                  recipe.tags.map((tag) => (
                    <Badge key={tag} bg="secondary" className="recipe-tag-badge me-1">
                      {tag}
                    </Badge>
                  ))
                ) : (
                  <span className="text-muted">—</span>
                )}
              </StackedCell>
              <StackedCell label="Time">{time || <span className="text-muted">—</span>}</StackedCell>
              <StackedCell label="Serves">
                {recipe.servings ?? <span className="text-muted">—</span>}
              </StackedCell>
              <StackedCell label="Actions" className="text-end">
                <Actions
                  recipe={recipe}
                  canEdit={canEdit(recipe)}
                  copyTarget={copyTarget(recipe)}
                  onCopy={onCopy}
                  onDelete={onDelete}
                  compact
                />
              </StackedCell>
            </StackedRow>
          );
        })}
      </StackedBody>
    </StackedTable>
  );
}
