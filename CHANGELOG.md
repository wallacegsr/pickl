# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The version shown at the foot of the sidebar is the one in `package.json`. When
it changes, the Android shell's `versionName` in `android/app/build.gradle.kts`
changes with it — the two must never disagree about what is running.

## [Unreleased]

## [2.4.1] - 2026-09-23

### Security

- **Only the platform operator can change deployment-wide settings.** The
  SMTP settings, the SMTP test email and the Google OAuth client were guarded
  by *household* admin, so on a deployment with several households any
  household's admin could read or replace them — redirecting every
  household's verification and invite mail, or the OAuth client every
  user's calendar authorises. The admin page already hid these tabs; the API
  now refuses too.
- **Deactivating or deleting an account ends its session.** The session
  refresh re-read the role but not whether the account was still active, so a
  deactivated person stayed signed in until their token expired (up to 30
  days). They are now signed out on their next request.
- **Login is throttled.** Eight wrong passwords for one address, or thirty
  from one client, lock that out for fifteen minutes. Sign-up, resending a
  verification email, and accepting an invite are limited per client too.
  A wrong address now takes as long as a wrong password, so timing no longer
  reveals which emails have accounts.
- **Exports can't carry spreadsheet formulas.** A CSV field starting with
  `=`, `+`, `-` or `@` is defused, so a recipe named like a formula stays
  text when an export is opened in Excel or Sheets.
- **Editing someone else's private recipe answers "not found"**, as reading it
  does, instead of confirming the id exists.
- **Recipe text has limits** (20,000 characters of ingredients, 50,000 of
  method, 10,000 of notes), so one request can't store megabytes in a row every
  page reads.
- **Baseline security headers** on every response: no framing (clickjacking),
  no MIME sniffing, a stricter referrer policy, and no `X-Powered-By`.
- **Next's image optimiser is switched off.** Pickl never used it, but the
  endpoint existed and carries critical advisories on Next 14.
- **nodemailer 8 → 9.1.1**, fixing its five published advisories.

### Changed

- **The plan page is about a third lighter.** Each recipe is sent to the
  browser once, not once per meal it suits, and without its ingredient list
  unless it's planned this week. The recipe picker asks the server for
  ingredient matches instead. On real recipes, whose ingredient lists run to a
  kilobyte or more, the saving is much larger than on test data.
- **Database indexes** on the paths every page takes: recipes by household,
  tags by tag, plan entries by household and date and by recipe, the audit log
  by household and time, and the foreign keys that cascade on delete. Adds one
  migration, which only creates indexes.
- **The README is a page, not a manual.** It now shows the current design in
  fresh screenshots and says what Pickl does in a screenful; the deep
  reference moved to `docs/calendars.md`, `docs/deployment.md` and
  `docs/architecture.md`.

### Fixed

- A household tag called "Quick" no longer appears twice in the recipe
  picker, once as the built-in filter and once as itself.

## [2.4.0] - 2026-09-18

### Added

- **A calmer recipe picker.** Choosing what goes in a meal slot is now a
  sheet: one search box (the Name/Tag/Ingredients tickboxes are gone),
  filter chips for favorites, quick and your tags, and rows you tap to add or
  remove. Before you type it suggests your favorites and things you have not
  cooked lately, each row showing when it was last cooked and how long it
  takes. Tags read as a quiet grey line rather than a row of coloured pills.
- **Choose your own picker chips**, under Preferences → Appearance: the
  household's most-used tags by default, or up to eight tags of your own.

### Changed

- **Back of House and Past Preserves match the rest.** Admin panels lost
  their cards and their badges became plain words (Suspended keeps a colour,
  since it is a state); report and admin tables have quiet uppercase headers
  and hairline rules; and on a phone the report filters sit in a sheet behind
  a Filters button instead of filling the screen above the report.
- **The rest of the app follows the same rules.** A recipe page leads with
  its name and one line of facts, with tags and source as links. Planned
  meals in the week grid share one quiet surface instead of three rotating
  colours (desserts keep their tint and cake glyph). Settings panels dropped
  the card around them and the title that repeated the tab. Import results
  read as rows rather than a table.
- **The bulk confirmation and the recipe filters are sheets too.** The
  confirmation now says each thing once — the title names the action, the
  button carries the count, the body explains the consequence — and the phone
  filter drawer became a bottom sheet whose button shows how many recipes the
  filters leave.
- **The same calm layout beyond the picker.** The Tags page's "Recipes…"
  dialog and a calendar event's details are now the same sheet, recipe tiles
  carry one quiet line (meal, time, servings, tags) instead of rows of
  coloured pills, and the Recipes page has a single search box — it already
  searched names, tags and ingredients together.

## [2.3.0] - 2026-09-14

### Added

- **Recipes in the planner open their recipe page.** Click a recipe's name
  in a slot; click anywhere else in the slot to choose recipes as before.
- **Search for several things at once.** Separate terms with commas or
  semicolons and a recipe has to match all of them: "chicken thighs, orzo"
  finds recipes with both. Works on the Recipes page and in the planner's
  recipe picker.
- **A page for each recipe, for cooking from.** Click a recipe tile (or its
  name in the list view) to open it: meal types and tags, times, servings and
  source, ingredients, the method as numbered steps, and notes. Tick
  ingredients off as they go in and tap the step you are on; that is kept for
  this browser tab only, and "Start over" clears it. Edit and Copy are there
  when you are allowed to use them.
- **Recipe quick look links to the recipe.** Its name opens the recipe page.
- **Click a calendar event for its details.** Events from your own calendar,
  on the plan grid and in the Calendar events widget, open a window with when
  it is, where (with a map link), its notes, and a link to open it in Google
  Calendar. Only you see them, and like the titles they are fetched with the
  page and never stored. Notes are shown as plain text, with web addresses as
  links.
- **Export all, or export what you found.** Export on the Recipes page is now
  a menu: "Export all recipes" takes everything you can see, and "Export N
  matching" takes whatever the current tab, search and filters find, on every
  page rather than only the one on screen.
- **Show all recipes at once.** A "Show 50 / 100 / 250 / all" choice beside
  the sort, and a "Show all" button next to "Show more" on tiles. The choice
  sticks while you change filters.
- **Filter the Tags page.** Type to narrow the list, or switch on Unused only
  to find tags nothing carries. Select All and bulk delete follow the filter,
  so a selection never includes a tag you have filtered out of view.
- **Filters on the Recipes page.** A sidebar (a drawer on phones) narrows the
  jar by meal type, tags, your favorites, and "ready in 30 minutes or less",
  each showing how many recipes it would leave. Ticking two tags offers All or
  Any.
- **Sort recipes** by name, newest, recently planned, not planned lately, or
  most planned. The list view gains a "Last planned" column.
- **Select all matching.** Select a page, then widen to every recipe the
  search and filters find, across all pages, for copying, tagging or deleting.
  The confirmation still shows exactly what will happen before anything does.

### Changed

- **Days that have passed are read-only on the planner.** They are dimmed,
  their slots no longer open for editing, and the server refuses changes to
  them, so reports reflect what was actually planned. Their recipes still
  open. Crunch Time and Weekly Picks already only touch today onward.
- **Recipe quick look shows the next planned meal**, not only tonight's
  dinner: the rest of today, then the coming days of the week, skipping empty
  slots. A meal counts as past at 10:30 (breakfast), 3pm (lunch) and 9pm
  (dinner), by your device's clock. Its search box is gone; searching the jar
  is what the Recipes page is for.
- **Choosing tags to shake from is a search box now**, not a button for every
  tag. Focus it for the most-used tags, or type to find one; chosen tags
  become chips you can remove, and each shows how many recipes for the ticked
  meals carry it. Arrow keys and Enter work, and Backspace removes the last.
- **The Recipes page loads one page at a time.** Searching, filtering, sorting
  and paging now happen on the server, 50 recipes at a time, so a jar of
  thousands opens as fast as a jar of ten. The list view pages; tiles offer
  "Show more". Search, filters, sort and page are in the address, so a
  filtered view survives a refresh and the back button and can be bookmarked.
- A jar of more than 200 recipes opens in the list view unless you have chosen
  a layout on that device.
- The Tags page's **Recipes…** dialog searches and pages through the jar
  instead of loading all of it, and remembers your ticks across pages.

### Fixed

- **"Today" is now today where you are, not where the server is.** A server
  on UTC is already on tomorrow during a US evening, which caused two bugs:
  tonight's meals were refused as "already passed" (and Crunch Time aimed at
  tomorrow), and the Plan page drew different dates on the server than in
  the browser, making it redraw and **drop your colour scheme and collapsed
  sidebar** on reload. Your browser now tells the server its time zone, and
  the planner, spins, shopping list, exports and reports all use your date.
  The colour scheme and sidebar are also re-applied after the page loads, so
  a redraw can't reset them again.
- **Clearing or replacing a planned meal failed with "Could not update this
  slot"** once that meal had been sent to a connected calendar. The link Pickl
  keeps to the calendar event blocked the meal from being removed. It no
  longer does, and the event is still removed from your calendar. Needs the
  database migration that runs on startup.
- **The recipe search box dropped letters** when results arrived while you
  were still typing — typing "orzo" could leave "or". What you type now
  stays put.
- **Ticks on the shopping list now match between the Plan page and the
  Shopping List page.** Two causes: the sidebar's Shopping List link always
  opened the household list, even from your private plan; and returning to a
  page could show a cached copy with old ticks. The links now keep which plan
  and week you are on, the list re-reads its ticks each time it opens, and the
  Shopping List page has Household and My Private Plan tabs.
- **Connecting Google Calendar could "succeed" and then fail** with "Could
  not load your Google calendars (HTTP 403) … insufficient authentication
  scopes". Google lists each permission as its own checkbox and lets people
  untick them; Pickl stored whatever came back without checking. It now
  refuses a connection missing either calendar permission, explains which
  boxes to tick, and an existing half-granted connection shows a Reconnect
  button instead of Google's raw error.

## [2.2.0] - 2026-09-12

### Added

- **Tag many recipes at once.** Select recipes and choose Tag… to add or
  remove tags across all of them, or open Recipes… beside a tag on the Tags
  page and tick the recipes that should carry it. Add and remove only — other
  tags are never touched — and a brand-new tag name is flagged before saving
  so a typo does not quietly become a tag.
- **Favorites.** Star any recipe; stars are your own, not the household's.
  The recipe list can show only your starred recipes.
- **Choose what the jar picks from.** Crunch Time and Weekly Picks can be
  limited to your favorites and/or to recipes carrying chosen tags (all of
  them, or any), on top of the meal type. Desserts follow the same filter, and
  when nothing matches Pickl says which filter came up empty.
- **Paste a recipe in.** Recipes → Import → Paste, and Pickl pulls out the
  name, ingredients, method, times and servings from a block of text off a
  note, an email or a web page. It shows you what it worked out in the normal
  recipe form so you can fix anything it got wrong before saving — splitting a
  recipe apart is guesswork, and the guess is yours to check.
- **Import a file of recipes.** A list in Pickl's own shape, imported in one
  go, reporting on every row: what went in, what was already here, and what
  could not be read and why. Recipes already in the jar are matched by source
  URL and skipped unless you say otherwise.
- **Export recipes**, from the button on the recipe list. What comes out goes
  straight back in, so it is a backup and a way to move recipes between
  households rather than a report. It carries the recipes you can see — the
  shared pool plus your own private ones — and nothing about where they lived.
- **Select recipes in bulk.** Tick recipes, or Select All, to delete them or
  copy them in one go. Select All means what is on screen — the current tab,
  after any search — and narrowing the search drops whatever it hides from the
  selection, so a bulk action never reaches a recipe you cannot see.
- **Copy recipes between the House Jar and your Secret Stash**, from the
  selection bar, from any recipe's tile or row, or from its edit page. Anyone
  can copy a House Jar recipe into their own stash to change for themselves;
  copying into the House Jar is for admins, the same as adding a shared recipe
  by hand. It is always a copy: the original stays where it was, tags come
  with it, and copying the same recipe twice is caught.
- **A list view** for recipes, alongside the tiles, remembered per device. On a
  phone its rows become labelled cards, like the report tables.
- **Select tags in bulk to delete them**, with the same rules as deleting one:
  a tag only comes off recipes you can edit, and nothing else is touched.

### Changed

- Deleting a recipe now says how many planned meals go with it. They always
  did — a recipe's planned meals are removed with it, past ones included, so
  they also leave Past Preserves — but the confirmation only ever said "this
  cannot be undone".

### Fixed

- Searching recipes by a meal type — "dinner", "dessert", "breakfast" — found
  nothing, even though meal types show up as badges right beside the tags that
  search did find. They are stored separately from tags, so the search never
  looked at them. They now count as tags, in the recipe list, the plan page's
  recipe picker and the quick look alike. A search matches what the badge
  says: a recipe marked "Any meal" is not returned for "dinner", even though it
  can be planned for one.

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

[Unreleased]: https://github.com/wallacegsr/pickl/compare/v2.4.1...HEAD
[2.4.1]: https://github.com/wallacegsr/pickl/compare/v2.4.0...v2.4.1
[2.4.0]: https://github.com/wallacegsr/pickl/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/wallacegsr/pickl/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/wallacegsr/pickl/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/wallacegsr/pickl/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/wallacegsr/pickl/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/wallacegsr/pickl/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/wallacegsr/pickl/releases/tag/v1.0.0
