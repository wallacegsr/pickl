"use client";

import { useEffect, useState } from "react";
import { Card, Form } from "react-bootstrap";
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
}: {
  userId: string;
  savedPreference: string;
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
                  {option.label}
                  <span className="d-block text-muted small">
                    {option.description}
                  </span>
                </>
              }
            />
          ))}
        </Form>
      </Card.Body>
    </Card>
  );
}
