"use client";

import { useEffect, useState } from "react";
import { Button, Col, Form, Row } from "react-bootstrap";

/**
 * Ingredients and method, laid out for cooking from.
 *
 * Ingredients can be ticked off as they go in, and a step can be tapped to
 * mark your place. Both are for this cook only: remembered in this browser
 * tab for the recipe (so a refresh or a glance at another page doesn't lose
 * your place), never saved to the account, and cleared with "Start over".
 * They are not the shopping list's ticks, which mean "we have this".
 */
export default function RecipeCookingView({
  recipeId,
  ingredients,
  instructions,
}: {
  recipeId: string;
  ingredients: string[];
  instructions: string;
}) {
  const steps = splitSteps(instructions);
  const storageKey = `pickl-cooking-${recipeId}`;
  const [used, setUsed] = useState<Set<number>>(new Set());
  const [currentStep, setCurrentStep] = useState<number | null>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null");
      if (saved) {
        setUsed(new Set(saved.used ?? []));
        setCurrentStep(saved.step ?? null);
      }
    } catch {
      // Nothing saved, or storage unavailable: start fresh.
    }
  }, [storageKey]);

  function save(nextUsed: Set<number>, nextStep: number | null) {
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify({ used: [...nextUsed], step: nextStep }));
    } catch {
      // Still works for this view.
    }
  }

  function toggleIngredient(i: number) {
    const next = new Set(used);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setUsed(next);
    save(next, currentStep);
  }

  function chooseStep(i: number) {
    const next = currentStep === i ? null : i;
    setCurrentStep(next);
    save(used, next);
  }

  const started = used.size > 0 || currentStep !== null;

  return (
    <Row className="g-4">
      <Col lg={4}>
        <section>
          <h3 className="h5">Ingredients</h3>
          {ingredients.length === 0 ? (
            <p className="text-body-secondary">No ingredients listed.</p>
          ) : (
            ingredients.map((line, i) => (
              <Form.Check
                key={i}
                id={`ingredient-${i}`}
                type="checkbox"
                className="mb-1"
                checked={used.has(i)}
                onChange={() => toggleIngredient(i)}
                label={
                  <span className={used.has(i) ? "text-decoration-line-through text-body-secondary" : undefined}>
                    {line}
                  </span>
                }
              />
            ))
          )}
        </section>
      </Col>
      <Col lg={8}>
        <section>
          <div className="d-flex align-items-baseline gap-2">
            <h3 className="h5">Method</h3>
            {started && (
              <Button
                variant="link"
                size="sm"
                className="ms-auto p-0"
                onClick={() => {
                  setUsed(new Set());
                  setCurrentStep(null);
                  save(new Set(), null);
                }}
              >
                Start over
              </Button>
            )}
          </div>
          {steps.length === 0 ? (
            <p className="text-body-secondary">No method written yet.</p>
          ) : (
            <ol className="ps-0 mb-0" style={{ listStyle: "none" }}>
              {steps.map((step, i) => {
                const active = currentStep === i;
                return (
                  <li key={i} className="mb-2">
                    <button
                      type="button"
                      onClick={() => chooseStep(i)}
                      aria-pressed={active}
                      className={`w-100 text-start border rounded p-2 d-flex gap-2 ${
                        active ? "border-primary bg-primary-subtle" : "bg-transparent"
                      }`}
                      style={{ color: "inherit" }}
                      title={active ? "Tap again to clear" : "Mark this as the step you're on"}
                    >
                      {steps.length > 1 && (
                        <span className="fw-semibold text-body-secondary" style={{ minWidth: "1.5rem" }}>
                          {i + 1}.
                        </span>
                      )}
                      <span style={{ whiteSpace: "pre-wrap" }}>{step}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </Col>
    </Row>
  );
}

/**
 * The method as steps: one per paragraph or line, with any "1." / "Step 2:"
 * numbering the author typed dropped, since the list numbers them itself.
 */
function splitSteps(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^(step\s*)?\d+\s*[.):-]\s*/i, ""))
    .filter(Boolean);
}
