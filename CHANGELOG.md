# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The version shown at the foot of the sidebar is the one in `package.json`. When
it changes, the Android shell's `versionName` in `android/app/build.gradle.kts`
changes with it — the two must never disagree about what is running.

## [Unreleased]

## [2.1.0] - 2026-09-10

### Added

- **Pickl has a logo.** A rounded box with the pickle punched out of it, so
  whatever is behind shows through — in the header, on the sign-in and sign-up
  cards, and on the offline page. It replaces the 🥒 emoji, which was never
  really a mark.
- The favicon, the home-screen icons and the Android launcher icon are the same
  drawing. Those are painted rather than punched: they land on a tab strip or a
  wallpaper this app does not control, and a transparent pickle can sink into
  one.
- Four more colour schemes: **Golden Hour** (amber on warm paper), **Brick**
  (terracotta and warm clay), **Slate** (cool indigo on near-white) and
  **Graphite** (near-neutral, with colour kept for the things that mean
  something). Each works in light and dark, same as the two before them.
- The header follows the colour scheme instead of being the same dark green
  under all of them. One bar for both light and dark, deliberately: it reads as
  chrome rather than as page.
- The colour scheme picker shows a swatch of each palette's actual paper,
  button and link colours, in whichever mode is currently showing.
- `node scripts/check-palettes.mjs` checks every palette's contrast — body,
  muted and link text, borders, and each button's label against its own fill,
  in both modes. It reads the colours out of the stylesheet rather than keeping
  a copy, so it cannot report on a palette that is no longer the one shipping.
- A **Checks** workflow runs the type checker and that contrast script on every
  push to main and every pull request, so neither depends on someone
  remembering to run it.

### Changed

- **Fresh & Sunny is now Fresh & Crisp**, and looks nothing like it did: pale
  mint on a near-black green, with a light mode built to match rather than the
  other way round. It was close enough to Jar & Brine to be hard to tell apart.
  If you had it selected you keep it — only the name and the colours changed.
- A palette may name a different accent for dark mode. Most do not need to, but
  one designed around a dark ground does: a pale mint that carries dark ink
  beautifully at #0E1512 is a washed-out button on white paper.
- A palette is now defined by sixteen colours passed to a mixin, rather than
  163 lines of hand-written rules. Hover, active and disabled states, button
  label colours and every dark-mode accent are derived from those sixteen by
  Bootstrap's own functions. Adding a scheme was a copy-paste-and-hope job and
  is now about eighteen lines.
- Fresh & Sunny's dark-mode accents shift by a few points per channel. They
  were hand-picked tints of the light-mode hues; they are now computed tints of
  the same hues, which is what they were approximating.

## [2.0.0] - 2026-09-09

Pickl can now host more than one household, which is why this is a major
version rather than a minor one. A single-family install carries on as it was —
the migration adopts everything already there into one household — but two
things behave differently enough on an existing deployment to be worth reading
before you upgrade. Both are under **Changed**.

### Added

- **Households.** Every recipe, tag, plan entry, shopping list and audit entry
  now belongs to a household, and is reachable only from inside it — by id, by
  search, by report, and by calendar sync alike. Two households can use the
  same tag and recipe names without ever meeting. A single-family install is
  unchanged: it is simply a deployment with one household.
- Two kinds of administrator. A **household admin** runs their own family:
  members, shared recipes, settings. The **global admin** runs the deployment
  and — deliberately — has no way into any household's contents. Household
  privacy does not depend on the global admin choosing not to look.
- Signing up creates your own household, with you as its admin. Joining an
  existing household happens by invitation, so nobody arrives in a family
  without someone in it deciding so.
- Back of House now shows each admin their own job. A household admin gets
  their members and their household's name; the global admin gets the list of
  households, email delivery and the calendar integration. On a single-family
  install one person holds both and sees all of it, as before.
- The global admin can create, rename, suspend and delete households, and see
  how big each one is — members, recipes, planned meals — without any way to
  see what is in one. Deleting asks for the household's name typed out, and
  says exactly what it is about to destroy.
- A suspended household can still be signed into and read, but nothing in it
  can be changed until it is resumed. Suspending is reversible and keeps
  everything; deleting is neither.
- Pickl can be installed to a phone's home screen and runs without browser
  chrome. On Android that sits alongside the APK; on iPhone, where there is no
  sideloading, it is the only way to install Pickl at all.
- **The shopping list has its own screen**, reachable from the nav and from the
  installed app's shortcut. It was only ever a widget on the plan page, which
  is right at a desk and wrong in a shop.
- Report tables become cards on a phone, each value labelled with its column,
  instead of a ten-column grid you drag sideways with the header out of view.
- The slot editor opens as a sheet from the bottom edge on a phone, next to the
  thumb that tapped, rather than as a dialog centred over the cell.
- Pickl now says "no connection" instead of showing the browser's error page
  when the network drops. It deliberately keeps no copy of your plan, recipes
  or shopping list on the device: a remembered meal shown on an offline screen
  reads as today's, and a copy of one household's week has no business
  outliving a sign-out on a shared phone.
- A meal slot can hold several recipes: a main and a dessert, or two mains for
  a household cooking around an intolerance. Recipes in the same slot are
  colour-coded so they read apart at a glance; a slot holding one recipe looks
  exactly as it did before.
- The recipe form's tags box suggests existing tags as you type, matching the
  tag you are currently typing rather than the whole field. Arrow keys and
  Enter pick one; anything new is still a new tag.
- Tags in that box appear as removable pills — comma or Enter adds one,
  Backspace or the pill's × removes one.
- On the Tags page, a tag's recipe count links to the recipe list filtered to
  that tag.
- Desserts. A recipe can be tagged **Dessert**, which is a category rather than
  a fourth meal slot — a dessert is planned alongside a meal and told apart
  there by its own colour and a cake marker. Shaking never proposes a dessert
  as a main, and "Dessert" in the shaker adds one to the last meal ticked.

- A **Patterns** report on Past Preserves: how often each meal actually gets
  planned, average cook time by day of the week, the tag mix, dessert
  frequency, and who does the planning.
- Recipe Frequency now lists every recipe, including ones never planned, with
  when each was last planned and how long ago — so it answers "what haven't we
  had in ages?" as well as "what do we cook most". It also reports a per-month
  rate, so two different date ranges can be compared.
- Meal History gains a tag column, a tag filter, and optional grouping by week
  or month.
- The Audit Log gains a "plan changes only" filter, hiding tag, recipe and
  preference edits.

### Fixed

- Ticking an ingredient off the shopping list did nothing. Slots gained the
  ability to hold several recipes, and the list kept sending its updates
  without saying which recipe a line belonged to, so every one of them was
  rejected.
- The Audit Log's date range now means the **viewer's** day, not the server's.
  In a container the server keeps UTC time, so for anyone west of it the range
  ended early — in California, everything after 5pm fell outside a range naming
  that very date. The browser now resolves the picked dates to instants,
  because it is the only side that knows which day the user meant.
- The Audit Log's date range filtered on the date a *meal was planned for*
  rather than when the action happened. Tag edits, recipe edits and theme
  changes carry no meal date and so vanished from any dated report entirely,
  and a shake that filled the rest of the week was judged by the days it
  planned for rather than the day it ran. The range is now inclusive of both
  whole days.
- Saving a recipe tagged **Dessert** failed with "Invalid enum value". The API's
  meal-type list was written out by hand and had not gained "dessert", so the
  checkbox existed but nothing it produced could be stored. Both meal-type
  enums are now derived from the schema, and "dessert" survives the "Any meal"
  collapse rather than being silently dropped on save.

### Changed

- **Self-signup no longer joins the existing household.** Anyone signing up now
  gets their own, with themselves as its admin. If you have been telling family
  members to sign up at your URL to join the household, that no longer works —
  invite them from Back of House instead. The old behaviour cannot be kept:
  signup is open to whoever can reach the page, so joining an existing family
  by simply signing up would hand a stranger the household's calendar.
- **SMTP and the calendar integration are the global admin's alone.** They are
  deployment settings rather than household ones. On a single-family install
  the same person holds both roles and sees no difference; a second household
  admin who could previously reach those panels no longer can.
- The JSON export gives each meal an **array** of recipes rather than one
  recipe or null; an empty array is the unplanned case. Anything consuming that
  export needs updating. Classed as a minor change rather than a major one:
  the export is a convenience for moving data out, not a published API with
  callers to keep faith with.
- The Past Preserves icon is a chart rather than an amphora, so it says what
  the page does while keeping the name.

- CI now verifies the Android signing keystore opens before starting a release
  build, so a wrong secret fails immediately and names the likely culprit.
- The Android keystore type is stated explicitly via the ANDROID_KEYSTORE_TYPE
  repository variable rather than inferred from the JDK default, so a PKCS#12
  keystore works as well as a JKS one.

## [1.1.0] - 2026-09-05

A minor release rather than a patch: everything below is new,
backwards-compatible functionality, which is what MINOR means under Semantic
Versioning. Nothing here requires action on an existing deployment.

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

[Unreleased]: https://github.com/wallacegsr/pickl/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/wallacegsr/pickl/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/wallacegsr/pickl/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/wallacegsr/pickl/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/wallacegsr/pickl/releases/tag/v1.0.0
