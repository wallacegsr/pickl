"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Col, Form, Row, Spinner } from "react-bootstrap";
import type { Recipe } from "@/db/schema";

const MEAL_TYPE_OPTIONS = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "any", label: "Any meal" },
] as const;

export interface RecipeFormValues {
  name: string;
  ingredients: string;
  instructions: string;
  prepTimeMinutes: string;
  cookTimeMinutes: string;
  servings: string;
  tags: string;
  sourceUrl: string;
  notes: string;
  visibility: "shared" | "private";
  mealType: string[];
}

function recipeToFormValues(recipe?: Recipe | null, isAdmin?: boolean): RecipeFormValues {
  return {
    name: recipe?.name ?? "",
    ingredients: recipe?.ingredients ?? "",
    instructions: recipe?.instructions ?? "",
    prepTimeMinutes: recipe?.prepTimeMinutes?.toString() ?? "",
    cookTimeMinutes: recipe?.cookTimeMinutes?.toString() ?? "",
    servings: recipe?.servings?.toString() ?? "",
    tags: recipe?.tags ?? "",
    sourceUrl: recipe?.sourceUrl ?? "",
    notes: recipe?.notes ?? "",
    visibility:
      (recipe?.visibility as "shared" | "private" | undefined) ??
      (isAdmin ? "shared" : "private"),
    mealType: recipe?.mealType
      ? recipe.mealType.split(",").map((t) => t.trim()).filter(Boolean)
      : ["any"],
  };
}

export default function RecipeForm({
  recipe,
  recipeId,
  isAdmin = false,
}: {
  recipe?: Recipe | null;
  recipeId?: string;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<RecipeFormValues>(
    recipeToFormValues(recipe, isAdmin)
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = Boolean(recipeId);
  // Only admins may choose "shared" — a non-admin's recipes are always private.
  const canChooseVisibility = isAdmin;

  function update<K extends keyof RecipeFormValues>(
    key: K,
    value: RecipeFormValues[K]
  ) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function toggleMealType(value: string) {
    setValues((prev) => {
      const has = prev.mealType.includes(value);
      const next = has
        ? prev.mealType.filter((v) => v !== value)
        : [...prev.mealType, value];
      return { ...prev, mealType: next.length > 0 ? next : prev.mealType };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const payload = {
      name: values.name,
      ingredients: values.ingredients,
      instructions: values.instructions,
      prepTimeMinutes: values.prepTimeMinutes
        ? Number(values.prepTimeMinutes)
        : null,
      cookTimeMinutes: values.cookTimeMinutes
        ? Number(values.cookTimeMinutes)
        : null,
      servings: values.servings ? Number(values.servings) : null,
      tags: values.tags,
      sourceUrl: values.sourceUrl || null,
      notes: values.notes || null,
      visibility: canChooseVisibility ? values.visibility : "private",
      mealType: values.mealType,
    };

    const url = isEdit ? `/api/recipes/${recipeId}` : "/api/recipes";
    const method = isEdit ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setError(data.error || "Something went wrong.");
      return;
    }

    router.push("/recipes");
    router.refresh();
  }

  return (
    <Form onSubmit={handleSubmit}>
      {error && <Alert variant="danger">{error}</Alert>}

      <Form.Group className="mb-3" controlId="recipe-name">
        <Form.Label>Name</Form.Label>
        <Form.Control
          required
          value={values.name}
          onChange={(e) => update("name", e.target.value)}
        />
      </Form.Group>

      <Row>
        <Col md={4}>
          <Form.Group className="mb-3" controlId="recipe-prep">
            <Form.Label>Prep Time (minutes)</Form.Label>
            <Form.Control
              type="number"
              min={0}
              value={values.prepTimeMinutes}
              onChange={(e) => update("prepTimeMinutes", e.target.value)}
            />
          </Form.Group>
        </Col>
        <Col md={4}>
          <Form.Group className="mb-3" controlId="recipe-cook">
            <Form.Label>Cook Time (minutes)</Form.Label>
            <Form.Control
              type="number"
              min={0}
              value={values.cookTimeMinutes}
              onChange={(e) => update("cookTimeMinutes", e.target.value)}
            />
          </Form.Group>
        </Col>
        <Col md={4}>
          <Form.Group className="mb-3" controlId="recipe-servings">
            <Form.Label>Servings</Form.Label>
            <Form.Control
              type="number"
              min={0}
              value={values.servings}
              onChange={(e) => update("servings", e.target.value)}
            />
          </Form.Group>
        </Col>
      </Row>

      <Form.Group className="mb-3" controlId="recipe-ingredients">
        <Form.Label>Ingredients (one per line)</Form.Label>
        <Form.Control
          as="textarea"
          rows={6}
          required
          value={values.ingredients}
          onChange={(e) => update("ingredients", e.target.value)}
        />
      </Form.Group>

      <Form.Group className="mb-3" controlId="recipe-instructions">
        <Form.Label>Instructions</Form.Label>
        <Form.Control
          as="textarea"
          rows={6}
          required
          value={values.instructions}
          onChange={(e) => update("instructions", e.target.value)}
        />
      </Form.Group>

      <Form.Group className="mb-3" controlId="recipe-tags">
        <Form.Label>Tags (comma separated)</Form.Label>
        <Form.Control
          value={values.tags}
          placeholder="e.g. vegetarian, quick, pasta"
          onChange={(e) => update("tags", e.target.value)}
        />
      </Form.Group>

      <Form.Group className="mb-3">
        <Form.Label>Meal types</Form.Label>
        <div className="d-flex flex-wrap gap-3">
          {MEAL_TYPE_OPTIONS.map((opt) => (
            <Form.Check
              key={opt.value}
              type="checkbox"
              id={`recipe-meal-${opt.value}`}
              label={opt.label}
              checked={values.mealType.includes(opt.value)}
              onChange={() => toggleMealType(opt.value)}
            />
          ))}
        </div>
        <Form.Text muted>
          &quot;Any meal&quot; makes this recipe eligible for every meal slot.
        </Form.Text>
      </Form.Group>

      <Form.Group className="mb-3">
        <Form.Label>Visibility</Form.Label>
        {canChooseVisibility ? (
          <Form.Select
            value={values.visibility}
            onChange={(e) =>
              update("visibility", e.target.value as "shared" | "private")
            }
          >
            <option value="shared">Shared (household pool)</option>
            <option value="private">Private (only me)</option>
          </Form.Select>
        ) : (
          <Form.Control disabled value="Private (only me)" />
        )}
        {!canChooseVisibility && (
          <Form.Text muted>
            Only admins can add recipes to the shared household pool.
          </Form.Text>
        )}
      </Form.Group>

      <Form.Group className="mb-3" controlId="recipe-source">
        <Form.Label>Source URL</Form.Label>
        <Form.Control
          type="url"
          value={values.sourceUrl}
          placeholder="https://..."
          onChange={(e) => update("sourceUrl", e.target.value)}
        />
      </Form.Group>

      <Form.Group className="mb-3" controlId="recipe-notes">
        <Form.Label>Notes</Form.Label>
        <Form.Control
          as="textarea"
          rows={3}
          value={values.notes}
          onChange={(e) => update("notes", e.target.value)}
        />
      </Form.Group>

      <div className="d-flex gap-2">
        <Button type="submit" disabled={loading}>
          {loading ? (
            <Spinner animation="border" size="sm" />
          ) : isEdit ? (
            "Save Changes"
          ) : (
            "Create Recipe"
          )}
        </Button>
        <Button
          variant="outline-secondary"
          type="button"
          onClick={() => router.push("/recipes")}
        >
          Cancel
        </Button>
      </div>
    </Form>
  );
}
