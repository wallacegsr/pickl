# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The version shown at the foot of the sidebar is the one in `package.json`. When
it changes, the Android shell's `versionName` in `android/app/build.gradle.kts`
changes with it — the two must never disagree about what is running.

## [Unreleased]

### Added

- Android app: a thin WebView shell that connects to a server address you
  supply, published as an APK from CI. Downloads, cookies, back navigation and
  offline errors are handled by the shell; the web app is unchanged inside it.
- `GET /api/health`, an anonymous probe returning the app name and version, so
  the Android connect screen can tell "unreachable" from "reachable, but not
  Pickl".
- Charts on Past Preserves: a doughnut of meals by type, horizontal bars for
  the most-planned recipes, and a line per meal type over time. Display only —
  the CSV export is unchanged.
- A second colour scheme, "Fresh & Sunny", selectable per device under
  Preferences → Appearance and working with both light and dark.
- A Tags section for renaming, merging, deleting and adding the words recipes
  are filed under.
- A bottom navigation bar on phones, replacing the off-canvas drawer.
- Server-rendered shopping list export at `/api/shopping-list/export`.
- This changelog, and the app version at the foot of the sidebar.

### Changed

- Navigation restructured: account items collapse into an avatar menu in the
  top-right, and the destinations moved into a collapsible sidebar.
- Below 768px the meal plan is one card per day instead of a table that
  scrolled sideways.
- Shell icons now come from Lucide rather than being hand-drawn.
- Recipes require only a name; every other field is optional, and "Any meal"
  acts as an override rather than another checkbox.
- Tags moved from a comma-separated column to a real table.
- Recipes offered when picking a meal are sorted alphabetically.
- The dashboard's default widget arrangement and sizes were rebuilt to match
  the intended layout, and the meal plan's columns can be resized.
- Sidebar collapse arrows sit on the right, next to the edge they move.

### Fixed

- Dark mode no longer resets on refresh. A hydration mismatch was making React
  re-render the root and discard the theme attribute set before hydration.
- Dashboard widget layouts persist across navigation, and "Reset to default"
  sticks.
- The "User Settings" icon is a gear. It had been drawn as a sun, identical to
  the light-mode toggle two rows below it.
- The slot editor's recipe search shows live results instead of filtering
  options inside a collapsed dropdown.
- The first account created (the global admin) bypasses email verification, so
  a broken SMTP configuration cannot lock everyone out.

## [1.0.0] - 2026-08-24

Initial public release: the container image published to
`ghcr.io/wallacegsr/pickl`.

### Added

- Weekly meal planning for breakfast, lunch and dinner, across a shared
  household calendar and a private per-user one.
- "Crunch Time" and "Weekly Picks" — random recipe selection for a single day
  or the rest of the week, with an option to keep or replace existing picks.
- Recipe management with tags, ingredients and visibility, and search by name,
  tag or ingredient.
- A configurable widget dashboard.
- Shopping list built from the week's plan, with on-hand tracking, clipboard
  copy and file export.
- Reports: meal history, recipe frequency and a full audit log, each
  exportable as CSV.
- Accounts with email verification, roles, invitations, and an admin area for
  users, SMTP and calendar integration.
- Google Calendar and CalDAV integration, per user, read-only overlay and
  push of planned meals.
- Light and dark themes.
- Docker deployment, with the image published to GHCR.

[Unreleased]: https://github.com/wallacegsr/pickl/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/wallacegsr/pickl/releases/tag/v1.0.0
