"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { Dropdown } from "react-bootstrap";
import {
  readStoredPreference,
  resolveTheme,
  setThemePreference,
  THEME_CHANGE_EVENT,
  type ResolvedTheme,
} from "@/lib/theme";
import { getPicklShell, type PicklShellBridge } from "@/lib/shell";
import {
  GearIcon,
  MoonIcon,
  RefreshIcon,
  ServerIcon,
  ShieldIcon,
  SignOutIcon,
  SunIcon,
} from "./icons";

/** First letter of the display name, falling back to the email, then "?". */
function initialFor(name?: string | null, email?: string | null) {
  const source = (name?.trim() || email?.trim() || "").replace(/^[^\p{L}\p{N}]+/u, "");
  return source ? source[0]!.toUpperCase() : "?";
}

/**
 * The circular avatar button in the top bar and the menu behind it.
 *
 * react-bootstrap's Dropdown supplies the keyboard behaviour (Enter/Space to
 * open, arrow keys to move, Escape to close, focus returned to the toggle) and
 * the aria-expanded/aria-haspopup wiring, so this component only supplies the
 * contents.
 */
export default function UserMenu() {
  const { data: session } = useSession();
  const user = session?.user;
  const userId = user?.id ?? null;
  // The same admin check the old navbar used, via the shared session shape.
  const isAdmin = user?.role === "admin";

  // Mirrors ThemeToggle exactly: "light" until the effect below corrects it.
  // The real value lives in a DOM attribute/localStorage the server cannot
  // know, so reading it during render would be a hydration mismatch. Only the
  // icon and label differ between the two states, and both settle on the
  // first commit. See src/lib/theme.ts.
  const [theme, setTheme] = useState<ResolvedTheme>("light");

  // Null in a browser, non-null inside the Android shell. Resolved after mount
  // rather than during render: the server cannot know which client will run
  // the markup, so branching on it while rendering would be a hydration
  // mismatch — the same trap that reset the theme once already.
  const [shell, setShell] = useState<PicklShellBridge | null>(null);
  useEffect(() => {
    setShell(getPicklShell());
  }, []);

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
    // ThemeSync and the Appearance panel on /preferences both announce
    // changes this way, which is what keeps this menu in step with them.
    window.addEventListener(THEME_CHANGE_EVENT, read);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, read);
  }, []);

  function toggleTheme() {
    const next: ResolvedTheme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemePreference(next, { userId });
  }

  const initial = initialFor(user?.name, user?.email);

  return (
    <Dropdown align="end">
      <Dropdown.Toggle
        // bsPrefix drops the `dropdown-toggle` class, and with it the caret —
        // the avatar circle is the whole affordance.
        bsPrefix="pickl-avatar-toggle"
        id="pickl-user-menu"
        aria-label={`Account menu for ${user?.name || user?.email || "your account"}`}
      >
        <span className="pickl-avatar" aria-hidden="true">
          {initial}
        </span>
      </Dropdown.Toggle>

      <Dropdown.Menu className="pickl-user-menu shadow">
        <div className="px-3 py-2">
          <div className="fw-semibold text-truncate">{user?.name || "Signed in"}</div>
          <div className="small text-body-secondary text-truncate">{user?.email}</div>
        </div>
        <Dropdown.Divider />

        <Dropdown.Item as={Link} href="/preferences">
          <GearIcon className="pickl-menu-icon" />
          User Settings
        </Dropdown.Item>

        {isAdmin && (
          <Dropdown.Item
            as={Link}
            href="/admin"
            title="User accounts, SMTP email settings, and the Google Calendar integration."
          >
            <ShieldIcon className="pickl-menu-icon" />
            Back of House
          </Dropdown.Item>
        )}

        <Dropdown.Item as="button" type="button" onClick={toggleTheme}>
          {theme === "dark" ? (
            <SunIcon className="pickl-menu-icon" />
          ) : (
            <MoonIcon className="pickl-menu-icon" />
          )}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </Dropdown.Item>

        {/* Only inside the Android shell. These were the native toolbar's
            overflow menu; folding them in here means the app has one menu
            rather than two stacked bars competing for the top of a phone
            screen. */}
        {shell && (
          <>
            <Dropdown.Divider />
            <Dropdown.Item as="button" type="button" onClick={() => shell.reload()}>
              <RefreshIcon className="pickl-menu-icon" />
              Reload
            </Dropdown.Item>
            <Dropdown.Item
              as="button"
              type="button"
              onClick={() => shell.changeServer()}
              title="Sign out and connect this app to a different Pickl server."
            >
              <ServerIcon className="pickl-menu-icon" />
              Change server
            </Dropdown.Item>
          </>
        )}

        <Dropdown.Divider />

        <Dropdown.Item
          as="button"
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          <SignOutIcon className="pickl-menu-icon" />
          Sign Out
        </Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>
  );
}

