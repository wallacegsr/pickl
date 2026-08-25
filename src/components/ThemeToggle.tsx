"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "react-bootstrap";
import {
  readStoredPreference,
  resolveTheme,
  setThemePreference,
  THEME_CHANGE_EVENT,
  type ResolvedTheme,
} from "@/lib/theme";

/**
 * Quick light/dark flip in the navbar. Picking a side here is an explicit
 * choice, so it stores "light"/"dark" (not "system") and — when logged in —
 * persists it to the user's record, same as the Appearance panel on
 * /preferences. The two stay in step via THEME_CHANGE_EVENT.
 */
export default function ThemeToggle() {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;

  // Starts as "light" and is corrected in the effect below rather than read
  // during render: the real value lives in a DOM attribute/localStorage that
  // the server cannot know, so reading it during render would produce a
  // hydration mismatch. The button's own markup is identical either way apart
  // from its icon, which settles on the first commit.
  const [theme, setTheme] = useState<ResolvedTheme>("light");

  useEffect(() => {
    const read = () => {
      const current = document.documentElement.getAttribute("data-bs-theme");
      if (current === "dark" || current === "light") {
        setTheme(current);
        return;
      }
      setTheme(resolveTheme(readStoredPreference() ?? "system"));
    };
    read();
    // ThemeSync and the Appearance panel both announce changes this way.
    window.addEventListener(THEME_CHANGE_EVENT, read);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, read);
  }, []);

  function toggle() {
    const next: ResolvedTheme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemePreference(next, { userId });
  }

  return (
    <Button
      variant="outline-light"
      size="sm"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </Button>
  );
}
