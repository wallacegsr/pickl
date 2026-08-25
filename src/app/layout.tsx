import type { Metadata } from "next";
// Bootstrap recompiled from Sass with the Pickl "jar & brine" palette. Must
// NOT be swapped back to bootstrap/dist/css/bootstrap.min.css: the prebuilt
// file hardcodes the stock blue into every component. See the file's header.
import "@/styles/pickl-bootstrap.scss";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pickl",
  description: "Out of the pickle, onto the plate.",
  icons: {
    icon: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🥒</text></svg>",
  },
};

// Runs before hydration to set data-bs-theme from localStorage (or OS
// preference on first visit), avoiding a flash of the wrong theme.
//
// The stored value is the user's *preference*: "light", "dark" or "system"
// (see src/lib/theme.ts). "system" — and anything unrecognised, including a
// first-ever visit — resolves against prefers-color-scheme here.
//
// This must stay localStorage-only and synchronous: it runs before React, and
// the logged-in user's saved preference isn't knowable this early. ThemeSync
// reconciles the two just after paint.
const themeInitScript = `
(function () {
  try {
    // NB: the storage key keeps its pre-"Pickl" name on purpose — renaming it
    // would silently discard every existing visitor's saved theme choice.
    // It must stay in sync with THEME_STORAGE_KEY in src/lib/theme.ts.
    var stored = localStorage.getItem("dinner-planner-theme");
    var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    var theme = stored === "light" || stored === "dark"
      ? stored
      : (prefersDark ? "dark" : "light");
    document.documentElement.setAttribute("data-bs-theme", theme);
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
