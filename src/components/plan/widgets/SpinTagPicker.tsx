"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Button, ButtonGroup, CloseButton, Form } from "react-bootstrap";
import { tagKey } from "@/lib/tagNames";

/** Suggestions shown at once. Typing narrows; nobody scrolls a hundred tags. */
const MAX_SUGGESTIONS = 8;

/**
 * Picks the tags a shake must match: type to find a tag, choose it, and it
 * becomes a removable chip.
 *
 * Replaces a wall of every tag as a button, which stopped being usable once a
 * household had a few dozen. Suggestions are drawn inline below the box
 * rather than as a floating menu, because the dashboard grid positions widgets
 * with transforms and a floating menu lands away from its input.
 *
 * With nothing typed, focusing the box offers the most-used tags, so the
 * common case needs no typing at all. Counts are recipes the jar could pick
 * for the meals ticked above.
 */
export default function SpinTagPicker({
  options,
  selected,
  onChange,
  match,
  onMatchChange,
}: {
  options: { name: string; count: number }[];
  selected: string[];
  onChange: (tags: string[]) => void;
  match: "all" | "any";
  onMatchChange: (match: "all" | "any") => void;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selectedKeys = useMemo(() => new Set(selected.map(tagKey)), [selected]);

  const suggestions = useMemo(() => {
    const needle = tagKey(text);
    const available = options.filter((o) => !selectedKeys.has(tagKey(o.name)));
    if (!needle) {
      return [...available].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, MAX_SUGGESTIONS);
    }
    // Names starting with what was typed first, then ones containing it.
    const starts = available.filter((o) => tagKey(o.name).startsWith(needle));
    const contains = available.filter((o) => !tagKey(o.name).startsWith(needle) && tagKey(o.name).includes(needle));
    return [...starts, ...contains].slice(0, MAX_SUGGESTIONS);
  }, [options, selectedKeys, text]);

  const matchesTotal = useMemo(() => {
    const needle = tagKey(text);
    return options.filter((o) => !selectedKeys.has(tagKey(o.name)) && (!needle || tagKey(o.name).includes(needle))).length;
  }, [options, selectedKeys, text]);

  function add(name: string) {
    onChange([...selected, name]);
    setText("");
    setActive(0);
    inputRef.current?.focus();
  }

  function remove(name: string) {
    onChange(selected.filter((t) => tagKey(t) !== tagKey(name)));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (open && suggestions[active]) {
        e.preventDefault();
        add(suggestions[active].name);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && !text && selected.length > 0) {
      remove(selected[selected.length - 1]);
    }
  }

  const countOf = (name: string) => options.find((o) => tagKey(o.name) === tagKey(name))?.count ?? 0;
  const showList = open && suggestions.length > 0;

  return (
    <div className="flex-grow-1" style={{ minWidth: "14rem", maxWidth: "32rem" }}>
      <div
        className="form-control form-control-sm d-flex flex-wrap align-items-center gap-1"
        style={{ cursor: "text", minHeight: "calc(1.5em + 0.5rem + 2px)", height: "auto" }}
        onClick={() => inputRef.current?.focus()}
      >
        {selected.map((tag) => (
          <span key={tagKey(tag)} className="badge text-bg-secondary d-inline-flex align-items-center gap-1 fw-normal">
            {tag}
            <span className="opacity-75">({countOf(tag)})</span>
            <CloseButton
              variant="white"
              aria-label={`Remove ${tag}`}
              style={{ fontSize: "0.55rem" }}
              onClick={(e) => {
                e.stopPropagation();
                remove(tag);
              }}
            />
          </span>
        ))}
        <input
          ref={inputRef}
          className="border-0 bg-transparent flex-grow-1 p-0"
          style={{ outline: "none", minWidth: "6rem", color: "inherit" }}
          placeholder={selected.length ? "Add another tag…" : "Any tag — type to filter"}
          aria-label="Tags a pick must carry"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${listId}-${active}` : undefined}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          // Delayed so a click on a suggestion lands before the list closes.
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
        />
      </div>

      {showList && (
        <ul id={listId} role="listbox" className="list-group mt-1 small">
          {suggestions.map((o, i) => (
            <li
              key={tagKey(o.name)}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`list-group-item list-group-item-action py-1 d-flex justify-content-between${i === active ? " active" : ""}`}
              style={{ cursor: "pointer" }}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => add(o.name)}
            >
              <span>{o.name}</span>
              <span className="opacity-75">{o.count}</span>
            </li>
          ))}
          {matchesTotal > suggestions.length && (
            <li className="list-group-item py-1 text-body-secondary">
              {matchesTotal - suggestions.length} more — keep typing to narrow
            </li>
          )}
        </ul>
      )}
      {open && text && suggestions.length === 0 && (
        <div className="small text-body-secondary mt-1">No tag matches “{text}”.</div>
      )}

      {selected.length >= 2 && (
        <div className="d-flex align-items-center gap-2 mt-2 small">
          <span className="text-body-secondary">A pick needs</span>
          <ButtonGroup size="sm" aria-label="How tags combine">
            <Button
              variant={match === "all" ? "secondary" : "outline-secondary"}
              aria-pressed={match === "all"}
              onClick={() => onMatchChange("all")}
            >
              all of them
            </Button>
            <Button
              variant={match === "any" ? "secondary" : "outline-secondary"}
              aria-pressed={match === "any"}
              onClick={() => onMatchChange("any")}
            >
              any of them
            </Button>
          </ButtonGroup>
          <Button variant="link" size="sm" className="p-0 ms-auto" onClick={() => onChange([])}>
            Clear tags
          </Button>
        </div>
      )}
    </div>
  );
}
