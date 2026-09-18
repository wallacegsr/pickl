"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TagAutocompleteField from "@/components/TagAutocompleteField";
import { formatTagInput, parseTagInput } from "@/lib/tagNames";
import { Button, Card, Form } from "react-bootstrap";
import {
  isThemePreference,
  readStoredPreference,
  setThemePreference,
  THEME_CHANGE_EVENT,
  type ThemePreference,
} from "@/lib/theme";
import {
  PALETTE_CHANGE_EVENT,
  PALETTES,
  readAppliedPalette,
  setPalette,
  type Palette,
} from "@/lib/palette";

const OPTIONS: { value: ThemePreference; label: string; hint: string }[] = [
  { value: "light", label: "Light", hint: "Always use the light theme." },
  { value: "dark", label: "Dark", hint: "Always use the dark theme." },
  {
    value: "system",
    label: "Match my system",
    hint: "Follow your operating system's light/dark setting.",
  },
];

export default function AppearanceSettingsPanel({
  userId,
  savedPreference,
  savedChips,
  defaultChips,
  tagSuggestions,
}: {
  userId: string;
  savedPreference: string;
  /** This person's own chip tags; empty means they have not chosen. */
  savedChips: string[];
  /** What the picker offers when they have not — shown so "Default" is not a mystery. */
  defaultChips: string[];
  tagSuggestions: string[];
}) {
  // Seeded from the server-rendered saved value so the checked radio matches
  // between server and client markup (no hydration mismatch); the effect then
  // picks up any change made from the navbar toggle while this is mounted.
  const [preference, setPreference] = useState<ThemePreference>(
    isThemePreference(savedPreference) ? savedPreference : "system"
  );

  useEffect(() => {
    const read = () => setPreference(readStoredPreference() ?? "system");
    read();
    window.addEventListener(THEME_CHANGE_EVENT, read);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, read);
  }, []);

  // Starts at the default so server and first client render agree; the effect
  // corrects it from the attribute the pre-hydration script already stamped.
  // Same reasoning as the theme radios above, and as the sidebar's chevron.
  const [palette, setPaletteState] = useState<Palette>("default");

  useEffect(() => {
    const read = () => setPaletteState(readAppliedPalette());
    read();
    window.addEventListener(PALETTE_CHANGE_EVENT, read);
    return () => window.removeEventListener(PALETTE_CHANGE_EVENT, read);
  }, []);

  // Which mode is actually showing, as opposed to which is preferred —
  // "system" resolves to either. Read off the attribute the app already
  // stamps on <html> rather than recomputed here, so there is one answer.
  //
  // Only the swatches use it. They need both attributes to match a palette's
  // surface rules, which are declared on
  // [data-pickl-palette=x][data-bs-theme=y]; with only the palette attribute
  // they match nothing and silently preview the page's own colours instead.
  //
  // Starts at "light" so server and first client render agree, then the
  // effect corrects it — same reasoning as the two states above.
  const [mode, setMode] = useState<"light" | "dark">("light");

  useEffect(() => {
    const read = () =>
      setMode(
        document.documentElement.getAttribute("data-bs-theme") === "dark"
          ? "dark"
          : "light"
      );
    read();
    window.addEventListener(THEME_CHANGE_EVENT, read);
    // "system" follows the OS, which can change with nobody touching the app.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", read);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, read);
      media.removeEventListener("change", read);
    };
  }, []);

  function choosePalette(next: Palette) {
    setPaletteState(next);
    setPalette(next);
  }

  function choose(next: ThemePreference) {
    setPreference(next);
    // Applies to the DOM, localStorage (for the next no-flash paint) and the
    // user's record in one go.
    setThemePreference(next, { userId });
  }

  const router = useRouter();

  // Chips: an empty list is the default set, so "Default" simply saves none.
  const [custom, setCustom] = useState(savedChips.length > 0);
  const [chipText, setChipText] = useState(formatTagInput(savedChips));
  const [savingChips, setSavingChips] = useState(false);
  const [chipNotice, setChipNotice] = useState<string | null>(null);

  async function saveChips(tags: string[]) {
    setSavingChips(true);
    setChipNotice(null);
    const res = await fetch("/api/preferences/picker-chips", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags }),
    }).catch(() => null);
    setSavingChips(false);
    if (!res || !res.ok) {
      setChipNotice("Could not save that.");
      return;
    }
    setCustom(tags.length > 0);
    setChipText(formatTagInput(tags));
    setChipNotice("Saved.");
    router.refresh();
  }

  return (
    <Card>
      <Card.Body>
        <Card.Title>Appearance</Card.Title>
        <Card.Text className="text-muted small">
          Applies straight away — there&apos;s nothing to submit.
        </Card.Text>

        <h3 className="h6 mb-1">Light or dark</h3>
        <p className="text-muted small mb-2">
          Saved to your account, so it follows you to other devices.
        </p>

        <Form>
          {OPTIONS.map((option) => (
            <Form.Check
              key={option.value}
              type="radio"
              name="themePreference"
              id={`theme-${option.value}`}
              className="mb-2"
              checked={preference === option.value}
              onChange={() => choose(option.value)}
              label={
                <>
                  {option.label}
                  <span className="d-block text-muted small">{option.hint}</span>
                </>
              }
            />
          ))}
        </Form>

        <hr className="my-4" />

        <h3 className="h6 mb-1">Colour scheme</h3>
        <p className="text-muted small mb-2">
          Works with either light or dark. Stored on this device only, so it
          won&apos;t follow you to another one.
        </p>

        <Form>
          {PALETTES.map((option) => (
            <Form.Check
              key={option.value}
              type="radio"
              name="palettePreference"
              id={`palette-${option.value}`}
              className="mb-2"
              checked={palette === option.value}
              onChange={() => choosePalette(option.value)}
              label={
                <>
                  <span className="d-inline-flex align-items-center gap-2">
                    {/*
                      The swatch carries the palette's own attribute, so the
                      three dots below resolve their colours from the palette's
                      real CSS rather than from a copy of its hexes kept here.
                      Nothing to keep in step, and a new palette gets a correct
                      swatch for free.

                      data-bs-theme is the mode actually showing, not a fixed
                      "light": a palette designed dark would otherwise advertise
                      itself with the colours it only uses on paper. It has to
                      be set rather than inherited, because a palette's surface
                      rules are keyed on both attributes together.
                    */}
                    <span
                      className="pickl-swatch"
                      data-pickl-palette={option.value}
                      data-bs-theme={mode}
                      aria-hidden="true"
                    >
                      <i style={{ background: "var(--bs-body-bg)" }} />
                      <i style={{ background: "var(--bs-primary)" }} />
                      <i style={{ background: "var(--bs-link-color)" }} />
                    </span>
                    {option.label}
                  </span>
                  <span className="d-block text-muted small">
                    {option.description}
                  </span>
                </>
              }
            />
          ))}
        </Form>
        <hr className="my-4" />

        <h3 className="h6 mb-1">Recipe picker chips</h3>
        <p className="text-muted small mb-2">
          The quick filters beside the search box when you choose a meal.
          Favorites and Quick are always there; these are the tags that sit
          after them.
        </p>

        <Form onSubmit={(e) => e.preventDefault()}>
          <Form.Check
            type="radio"
            name="pickerChips"
            id="chips-default"
            className="mb-1"
            checked={!custom}
            onChange={() => void saveChips([])}
            label={
              <>
                Default
                <span className="d-block text-muted small">
                  {defaultChips.length > 0
                    ? `Your household's most-used tags: ${defaultChips.join(", ")}`
                    : "Your household's most-used tags — there are none yet."}
                </span>
              </>
            }
          />
          <Form.Check
            type="radio"
            name="pickerChips"
            id="chips-custom"
            className="mb-2"
            checked={custom}
            onChange={() => setCustom(true)}
            label={
              <>
                Choose my own
                <span className="d-block text-muted small">
                  {/* Must match MAX_PICKER_CHIPS in src/lib/pickerChips.ts,
                      which cannot be imported here: it reads the database. */}
                  Up to 8 tags, in the order you type them.
                </span>
              </>
            }
          />

          {custom && (
            <div className="ms-4">
              <TagAutocompleteField
                id="picker-chip-tags"
                value={chipText}
                onChange={setChipText}
                suggestions={tagSuggestions}
                placeholder="Vegetarian, Weeknight, Slow cooker…"
              />
              <div className="d-flex align-items-center gap-2 mt-2">
                <Button
                  size="sm"
                  disabled={savingChips}
                  onClick={() => void saveChips(parseTagInput(chipText))}
                >
                  {savingChips ? "Saving…" : "Save chips"}
                </Button>
                {chipNotice && <span className="small text-body-secondary">{chipNotice}</span>}
              </div>
            </div>
          )}
        </Form>
      </Card.Body>
    </Card>
  );
}
