"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, ButtonGroup, Form, Modal } from "react-bootstrap";
import TagAutocompleteField from "@/components/TagAutocompleteField";
import { parseTagInput, tagKey } from "@/lib/tagNames";

/**
 * Chooses what a bulk tag change does, before its confirmation.
 *
 * Add and Remove only. There is no "replace with", because across a selection
 * of thirty recipes it would silently wipe whatever tags each one had.
 *
 * The two modes offer tags differently, because they are different questions:
 *
 *   - ADD takes any tag name, with suggestions from the household's existing
 *     ones. A new name is allowed; the confirmation will say it is new, so a
 *     typo does not quietly become a tag.
 *   - REMOVE offers only tags actually on the selection, each with how many of
 *     the selected recipes carry it. Offering the whole vocabulary would mostly
 *     be offering tags that none of these recipes have.
 */
export default function RecipeTagPicker({
  show,
  count: n,
  present: presentTags,
  suggestions,
  onCancel,
  onContinue,
}: {
  show: boolean;
  /** How many recipes are selected. */
  count: number;
  /** Tags on the selection, with how many of the selected carry each. */
  present: { name: string; count: number }[];
  suggestions: string[];
  onCancel: () => void;
  onContinue: (mode: "add" | "remove", tags: string[]) => void;
}) {
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [addValue, setAddValue] = useState("");
  const [removeKeys, setRemoveKeys] = useState<Set<string>>(new Set());

  // Fresh each time it opens: a half-typed tag from the last selection should
  // not be waiting to be applied to this one.
  useEffect(() => {
    if (show) {
      setMode("add");
      setAddValue("");
      setRemoveKeys(new Set());
    }
  }, [show]);

  const present = useMemo(
    () =>
      presentTags
        .filter((p) => p.count > 0)
        .map((p) => ({ key: tagKey(p.name), ...p }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    [presentTags]
  );

  const addTags = parseTagInput(addValue);
  const removeTags = present.filter((p) => removeKeys.has(p.key)).map((p) => p.name);
  const chosen = mode === "add" ? addTags : removeTags;

  return (
    <Modal show={show} onHide={onCancel} centered>
      <Modal.Header closeButton>
        <Modal.Title as="h2" className="h5">
          Tag {n} recipe{n === 1 ? "" : "s"}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <ButtonGroup className="mb-3" aria-label="Add or remove">
          <Button
            variant={mode === "add" ? "primary" : "outline-primary"}
            aria-pressed={mode === "add"}
            onClick={() => setMode("add")}
          >
            Add tags
          </Button>
          <Button
            variant={mode === "remove" ? "primary" : "outline-primary"}
            aria-pressed={mode === "remove"}
            onClick={() => setMode("remove")}
            disabled={present.length === 0}
            title={present.length === 0 ? "None of these recipes has a tag to remove." : undefined}
          >
            Remove tags
          </Button>
        </ButtonGroup>

        {mode === "add" ? (
          <Form.Group controlId="bulk-add-tags">
            <Form.Label>Tags to add</Form.Label>
            <TagAutocompleteField
              id="bulk-add-tags"
              value={addValue}
              onChange={setAddValue}
              suggestions={suggestions}
              placeholder="Start typing a tag…"
            />
            <Form.Text muted>
              Added to each selected recipe that doesn&apos;t already have it.
              Nothing else about their tags changes.
            </Form.Text>
          </Form.Group>
        ) : (
          <fieldset>
            <legend className="fs-6 fw-semibold">Tags to remove</legend>
            {present.map((p) => (
              <Form.Check
                key={p.key}
                type="checkbox"
                id={`bulk-remove-${p.key}`}
                checked={removeKeys.has(p.key)}
                onChange={() =>
                  setRemoveKeys((prev) => {
                    const next = new Set(prev);
                    if (next.has(p.key)) next.delete(p.key);
                    else next.add(p.key);
                    return next;
                  })
                }
                label={
                  <>
                    {p.name}{" "}
                    <span className="text-muted small">
                      — on {p.count} of {n}
                    </span>
                  </>
                }
              />
            ))}
            <Form.Text muted>
              Taken off the recipes that carry it. The tag itself stays, even if
              nothing uses it afterwards — remove it for good on the Tags page.
            </Form.Text>
          </fieldset>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={chosen.length === 0} onClick={() => onContinue(mode, chosen)}>
          Continue
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
