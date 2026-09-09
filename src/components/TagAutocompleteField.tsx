"use client";

import { useEffect, useRef, useState } from "react";
import { ListGroup } from "react-bootstrap";
import { normalizeTagName, parseTagInput, tagKey } from "@/lib/tagNames";

/** How many suggestions the list shows before it stops. */
const MAX_SUGGESTIONS = 8;

/**
 * The tags field: committed tags as pills, with a live suggestion list.
 *
 * Anything typed still becomes a tag — this is a token input, not a picker,
 * which is what the help text promises. The suggestions only save you retyping
 * (and re-capitalising) a tag that already exists.
 *
 * ---------------------------------------------------------------------------
 * The value is still one comma-separated string
 * ---------------------------------------------------------------------------
 * Pills are a rendering of that string, not a separate data model: everything
 * before the last comma is a pill, and the text after it is what you are
 * typing. Nothing else had to change — the form still submits a string, the
 * API still parses it with parseTagInput, and a half-typed tag is inside the
 * value rather than in some component state that a Save could race.
 *
 * Holding the pills in their own array would have needed the draft merged back
 * in on submit, and a tag typed but not yet committed would go missing if
 * anything read the value before that merge.
 *
 * A `<datalist>` would have been three lines, and is what the suggestion list
 * looks like at a glance. It cannot do the thing that makes this useful:
 * matching the *segment being typed* rather than the whole field. With a
 * datalist, "quick, veg" matches nothing.
 */
export default function TagAutocompleteField({
  value,
  onChange,
  suggestions,
  id = "recipe-tags",
  placeholder,
  describedBy,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Existing tag names the user is allowed to see. */
  suggestions: string[];
  id?: string;
  placeholder?: string;
  describedBy?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  /**
   * Everything before the last comma is committed and shown as pills; what
   * follows is the tag being typed.
   *
   * The caret no longer decides this. With pills there is no text to put a
   * caret into for an already-committed tag — you remove it and retype — so
   * the split is positional and the draft is always the tail.
   */
  const lastComma = value.lastIndexOf(",");
  const committedText = lastComma === -1 ? "" : value.slice(0, lastComma);
  // Leading whitespace is stripped, so the space in "Vegan, " belongs to the
  // separator rather than to the draft. Without this the draft is never empty
  // after committing a tag, and Backspace-to-remove never fires — a leading
  // space is not a tag anyone is trying to type.
  const draft = (lastComma === -1 ? value : value.slice(lastComma + 1)).replace(
    /^\s+/,
    ""
  );
  const pills = parseTagInput(committedText);

  const query = normalizeTagName(draft).toLowerCase();

  // Tags already in the box, so the list never offers a duplicate.
  const alreadyUsed = new Set(parseTagInput(value).map(tagKey));

  const matches = suggestions
    .filter((name) => !alreadyUsed.has(tagKey(name)))
    .filter((name) => (query ? name.toLowerCase().includes(query) : true))
    .sort((a, b) => {
      // A tag that starts with what was typed is the likelier target than one
      // that merely contains it somewhere.
      if (query) {
        const aStarts = a.toLowerCase().startsWith(query);
        const bStarts = b.toLowerCase().startsWith(query);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
      }
      return a.localeCompare(b, undefined, { sensitivity: "base" });
    })
    .slice(0, MAX_SUGGESTIONS);

  // A highlight left pointing past the end of a now-shorter list would make
  // Enter do nothing.
  useEffect(() => {
    setHighlight(0);
  }, [query, value]);

  const showList = open && matches.length > 0;

  /**
   * Rewrites the whole value from a list of pills plus a draft.
   *
   * Deliberately does not touch `open`: this runs on every keystroke, and
   * closing here would fight the reopen in the input's onChange.
   */
  function commit(nextPills: string[], nextDraft: string) {
    const head = nextPills.join(", ");
    // The trailing comma is what makes the last pill a pill rather than the
    // draft, so it is always present when there are any.
    onChange(head ? `${head}, ${nextDraft}` : nextDraft);
  }

  /** Types into the draft, leaving the pills alone. */
  function commitDraft(nextDraft: string) {
    // A comma pasted in (rather than typed, which handleKeyDown intercepts)
    // still means "these are separate tags", so it is split here too.
    if (nextDraft.includes(",")) {
      const parts = parseTagInput(nextDraft);
      const merged = [...pills];
      for (const part of parts) {
        if (!merged.some((p) => tagKey(p) === tagKey(part))) merged.push(part);
      }
      // Anything after the final comma is still being typed.
      const trailing = nextDraft.slice(nextDraft.lastIndexOf(",") + 1);
      commit(merged, normalizeTagName(trailing) ? trailing.trimStart() : "");
      return;
    }
    commit(pills, nextDraft);
  }

  /** Turns the draft (or a chosen suggestion) into a pill. */
  function pick(name: string) {
    const cleaned = normalizeTagName(name);
    if (!cleaned) return;
    // A tag already present is not added twice; the draft is simply cleared,
    // so accepting a duplicate does nothing rather than producing a second
    // identical pill that parseTagInput would drop anyway.
    const next = pills.some((p) => tagKey(p) === tagKey(cleaned))
      ? pills
      : [...pills, cleaned];
    commit(next, "");
    setOpen(false);
    inputRef.current?.focus();
  }

  function removePill(index: number) {
    commit(
      pills.filter((_, i) => i !== index),
      draft
    );
    inputRef.current?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    // Backspace on an empty draft takes the last pill off. Checked before the
    // suggestion list, because it has to work whether or not the list is open.
    if (event.key === "Backspace" && draft === "" && pills.length > 0) {
      event.preventDefault();
      removePill(pills.length - 1);
      return;
    }

    // A comma is how a tag is committed by typing rather than by picking.
    // Intercepted so it cannot land in the text and produce an empty segment.
    if ((event.key === "," || event.key === "Enter") && !showList) {
      if (normalizeTagName(draft)) {
        event.preventDefault();
        pick(draft);
      } else if (event.key === ",") {
        // Nothing to commit — swallow it rather than leaving a stray comma.
        event.preventDefault();
      }
      // A bare Enter with an empty draft falls through and submits the form,
      // which is what Enter normally does in a form field.
      return;
    }

    if (!showList) {
      // ArrowDown with a closed list is the standard way to ask for it.
      if (event.key === "ArrowDown" && matches.length > 0) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (event.key === ",") {
      // With the list open a comma still means "commit what I typed", not
      // "take the highlighted suggestion".
      event.preventDefault();
      if (normalizeTagName(draft)) pick(draft);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((h) => (h + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => (h - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      // Critical: without this, Enter submits the whole recipe form while the
      // user is only trying to accept a suggestion.
      event.preventDefault();
      const chosen = matches[highlight];
      if (chosen) pick(chosen);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "Tab") {
      // Tab means "leave the field", not "accept" — closing rather than
      // picking avoids putting a tag in that the user never chose.
      setOpen(false);
    }
  }

  const listboxId = `${id}-suggestions`;
  const activeOptionId = showList ? `${id}-option-${highlight}` : undefined;

  return (
    <div className="pickl-tag-field">
      {/* Looks like a form control and behaves like one: clicking anywhere in
          the box puts the caret in the real input at the end. */}
      <div
        className="pickl-tag-box form-control"
        onMouseDown={(e) => {
          // Only when the click missed the pills and the input itself, so a
          // remove button still works and text stays selectable.
          if (e.target === e.currentTarget) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        {pills.map((name, index) => (
          <span key={`${name}-${index}`} className="pickl-tag-pill">
            {name}
            <button
              type="button"
              className="pickl-tag-pill-remove"
              aria-label={`Remove tag ${name}`}
              // Keeps focus in the field so the box does not blur and close.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => removePill(index)}
            >
              ×
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          id={id}
          className="pickl-tag-input"
          // Only the tag being typed. The pills carry the rest.
          value={draft}
          placeholder={pills.length === 0 ? placeholder : undefined}
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          aria-describedby={describedBy}
          onChange={(e) => {
            commitDraft(e.target.value);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          // A click on an option fires blur first, so closing immediately would
          // unmount the option before its click landed. The options themselves
          // suppress the blur; this only has to cope with focus genuinely
          // leaving the field.
          onBlur={() => setOpen(false)}
        />
      </div>

      {showList && (
        <ListGroup
          id={listboxId}
          role="listbox"
          aria-label="Matching tags"
          className="pickl-tag-suggestions shadow-sm"
        >
          {matches.map((name, index) => (
            <ListGroup.Item
              key={name}
              id={`${id}-option-${index}`}
              as="button"
              type="button"
              role="option"
              aria-selected={index === highlight}
              active={index === highlight}
              // Keeps focus in the input so the field does not blur out from
              // under the click.
              onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => pick(name)}
            >
              {name}
            </ListGroup.Item>
          ))}
        </ListGroup>
      )}
    </div>
  );
}
