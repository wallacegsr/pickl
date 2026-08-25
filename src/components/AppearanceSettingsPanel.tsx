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
          Saved to your account, so it follows you to other devices. Applies
          straight away — there&apos;s nothing to submit.
        </Card.Text>

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
      </Card.Body>
    </Card>
  );
}
