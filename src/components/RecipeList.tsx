"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  Col,
  Row,
  Modal,
  Nav,
  Spinner,
} from "react-bootstrap";
import { useRouter } from "next/navigation";
import type { Recipe } from "@/db/schema";
import RecipeSearchBar from "@/components/RecipeSearchBar";
import {
  DEFAULT_RECIPE_SEARCH_FIELDS,
  matchesRecipeSearch,
  type RecipeSearchFields,
} from "@/lib/recipeSearch";

type Tab = "shared" | "mine";

export default function RecipeList({
  initialRecipes,
  currentUserId,
  isAdmin,
}: {
  initialRecipes: Recipe[];
  currentUserId: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [recipes, setRecipes] = useState(initialRecipes);
  const [tab, setTab] = useState<Tab>("shared");
  const [search, setSearch] = useState("");
  const [searchFields, setSearchFields] = useState<RecipeSearchFields>(
    DEFAULT_RECIPE_SEARCH_FIELDS
  );
  const [deleteTarget, setDeleteTarget] = useState<Recipe | null>(null);
  const [deleting, setDeleting] = useState(false);

  function canEdit(recipe: Recipe): boolean {
    if (recipe.visibility === "shared") return isAdmin;
    return recipe.ownerUserId === currentUserId;
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

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await fetch(`/api/recipes/${deleteTarget.id}`, {
      method: "DELETE",
    });
    setDeleting(false);
    if (res.ok) {
      setRecipes((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      setDeleteTarget(null);
      router.refresh();
    }
  }

  return (
    <div>
      <Nav variant="tabs" activeKey={tab} className="mb-3" onSelect={(k) => setTab((k as Tab) ?? "shared")}>
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
          {(tab === "mine" || isAdmin) && (
            <Link href="/recipes/new" passHref legacyBehavior>
              <Button as="a" variant="primary">
                + Add Recipe
              </Button>
            </Link>
          )}
        </Col>
      </Row>

      {filtered.length === 0 && (
        <p className="text-muted">
          {search.trim()
            ? "Nothing in the jar matches that search."
            : tab === "shared"
              ? "This jar's empty. Add a shared recipe to start filling it."
              : "Your own jar's empty. Add a private recipe only you can see."}
        </p>
      )}

      <Row xs={1} md={2} lg={3} className="g-3">
        {filtered.map((recipe) => {
          const mealTags = recipe.mealType
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
          return (
            <Col key={recipe.id}>
              <Card className="h-100 shadow-sm">
                <Card.Body className="d-flex flex-column">
                  <div className="d-flex justify-content-between align-items-start">
                    <Card.Title>{recipe.name}</Card.Title>
                    {recipe.visibility === "private" && (
                      <Badge bg="info" text="dark">
                        Private
                      </Badge>
                    )}
                  </div>
                  <div className="mb-2 small text-muted">
                    {recipe.prepTimeMinutes != null && (
                      <span className="me-2">
                        Prep: {recipe.prepTimeMinutes}m
                      </span>
                    )}
                    {recipe.cookTimeMinutes != null && (
                      <span className="me-2">
                        Cook: {recipe.cookTimeMinutes}m
                      </span>
                    )}
                    {recipe.servings != null && (
                      <span>Serves: {recipe.servings}</span>
                    )}
                  </div>
                  <div className="mb-2">
                    {mealTags.map((tag) => (
                      <Badge key={tag} bg="dark" className="recipe-tag-badge me-1">
                        {tag}
                      </Badge>
                    ))}
                    {recipe.tags
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean)
                      .map((tag) => (
                        <Badge
                          key={tag}
                          bg="secondary"
                          className="recipe-tag-badge"
                        >
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
                  {canEdit(recipe) && (
                    <div className="d-flex gap-2 mt-2">
                      <Link
                        href={`/recipes/${recipe.id}/edit`}
                        passHref
                        legacyBehavior
                      >
                        <Button as="a" size="sm" variant="outline-primary">
                          Edit
                        </Button>
                      </Link>
                      <Button
                        size="sm"
                        variant="outline-danger"
                        onClick={() => setDeleteTarget(recipe)}
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </Card.Body>
              </Card>
            </Col>
          );
        })}
      </Row>

      <Modal show={Boolean(deleteTarget)} onHide={() => setDeleteTarget(null)}>
        <Modal.Header closeButton>
          <Modal.Title>Delete recipe?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Are you sure you want to delete <strong>{deleteTarget?.name}</strong>
          ? This cannot be undone.
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmDelete} disabled={deleting}>
            {deleting ? <Spinner animation="border" size="sm" /> : "Delete"}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
