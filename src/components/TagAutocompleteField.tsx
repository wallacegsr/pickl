"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Form, ListGroup } from "react-bootstrap";
import { normalizeTagName, parseTagInput, tagKey } from "@/lib/tagNames";

/** How many suggestions the list shows before it stops. */
const MAX_SUGGESTIONS = 8;

/**
 * The comma-separated tags box, with a live list of matching existing tags.
 *
 * The field stays free text — anything typed still becomes a tag, which is the
 * behaviour the help text promises and the whole reason the box is a text
 * input rather than a picker. The list only saves you retyping (and
 * re-capitalising) a tag that already exists.
 *
 * A `<datalist>` would have been three lines, and is what this looks like at a
 * glance. It was not used because it cannot do the thing that makes this
 * useful: matching against the *segment being typed* rather than the whole
 * field. With a datalist, "quick, veg" matches nothing, because the browser
 * compares the entire value against each option.
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
  const [caret, setCaret] = useState(0);
  // Set when a pick rewrites the value, applied after React has re-rendered
  // with it — moving the caret before that would put it in the old string.
  const pendingCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    const input = inputRef.current;
    if (input) {
      input.setSelectionRange(pendingCaret.current, pendingCaret.current);
      setCaret(pendingCaret.current);
    }
    pendingCaret.current = null;
  });

  /**
   * The comma-delimited run the caret is sitting in.
   *
   * Editing the middle of "quick, veg, easy" should complete *that* tag, not
   * the last one, so the boundaries come from the caret rather than from the
   * end of the string.
   */
  function activeSegment() {
    const position = Math.min(caret, value.length);
    const start = value.lastIndexOf(",", position - 1) + 1;
    const nextComma = value.indexOf(",", position);
    const end = nextComma === -1 ? value.length : nextComma;
    return { start, end, text: value.slice(start, end) };
  }

  const segment = activeSegment();
  const query = normalizeTagName(segment.text).toLowerCase();

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

  function pick(name: string) {
    const before = value.slice(0, segment.start);
    const after = value.slice(segment.end);
    // Rebuilt rather than spliced so spacing is consistent however the
    // surrounding text was typed.
    const head = before.trimEnd();
    const joined = `${head ? `${head} ` : ""}${name}`;
    const tail = after.replace(/^\s*,?\s*/, "");
    const next = tail ? `${joined}, ${tail}` : `${joined}, `;
    onChange(next);
    // Just past the inserted tag and its separator, ready for the next one.
    pendingCaret.current = joined.length + 2;
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!showList) {
      // ArrowDown with a closed list is the standard way to ask for it.
      if (event.key === "ArrowDown" && matches.length > 0) {
        event.preventDefault();
        setOpen(true);
      }
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

  // react-bootstrap types Form.Control's handlers against a union of form
  // elements, so this reads the caret off the DOM node rather than a typed
  // HTMLInputElement.
  function syncCaret(event: { currentTarget: EventTarget & { selectionStart?: number | null } }) {
    setCaret(event.currentTarget.selectionStart ?? 0);
  }

  const listboxId = `${id}-suggestions`;
  const activeOptionId = showList ? `${id}-option-${highlight}` : undefined;

  return (
    <div className="pickl-tag-field">
      <Form.Control
        ref={inputRef}
        id={id}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        aria-describedby={describedBy}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? 0);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onFocus={() => setOpen(true)}
        // A click on an option fires blur first, so closing immediately would
        // unmount the option before its click landed. The options themselves
        // suppress the blur (see onMouseDown below); this only has to cope
        // with focus genuinely leaving.
        onBlur={() => setOpen(false)}
      />

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
