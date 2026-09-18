# How it fits together

The dashboard, migrations and the shape of the source tree. Part of
[Pickl](../README.md).

## The /plan dashboard

`/plan` is a **configurable dashboard**: a board of draggable, resizable
widgets whose arrangement is saved per user. The page chrome around it —
the Household / My Private Plan tabs and the admin's "viewing calendar for"
picker — is *not* a widget, because those decide what the whole board is
showing and must never be something you can accidentally hide.

The default arrangement is a wide left column for the week itself and a
narrow right column for what you consult while planning it:

```
  Shake the jar  (8 wide) │ Recipe quick look (4 wide)
  Meal plan      (8 wide) │ Shopping list     (4 wide)
  Calendar events        (full width)
```

Shaking sits directly above the grid it fills in. Default widget heights are
measured against real content rather than guessed, so nothing starts with a
lap of empty space — the shopping list is the deliberate exception, since a
full week of ingredients would otherwise push everything else off screen, so
it scrolls instead.

**Export lives in the Meal plan widget**, as a footer pinned below its
scrolling body. The buttons export whatever week and scope the grid is
showing, so they belong to it. One consequence worth knowing: hide that
widget and the export buttons go with it.

### The widgets

| Widget | What it is |
| --- | --- |
| **Meal plan** | The Sunday–Saturday grid, including the "On your calendar" overlay column. Tap a slot to open the picker sheet; tap a recipe's name to open the recipe. Past days are dimmed and read-only. Columns are resizable — see below. |
| **Shake things up** | The meal checkboxes plus 🥒 Crunch Time and 🫙 Weekly Picks, with their animations, and the "Only from" filters — favourites and a tag search. |
| **Shopping list** | The Today / Full Week ingredient checklist, with download and copy. |
| **Recipe quick look** | The next planned meal — the rest of today, then the coming days — with its tags and ingredients, and its name linking to the recipe. Deliberately compact: it is a glance, not a second `/recipes`. |
| **Calendar events** | This week's external calendar events as a list. Same opt-in and privacy rules as the grid's overlay column (see below). |

The registry that defines them lives in `src/lib/dashboard/widgets.ts`
(ids, titles, default geometry, size minimums) with the id → component map
in `src/components/plan/WidgetFrame.tsx`. Adding or removing a widget is an
edit to those two places and needs no data migration.

Every widget reads one shared state, held in `PlanView` and passed down
through `src/components/plan/PlanContext.tsx`. That is why the grid and the
Calendar events widget never issue two calendar requests, and why the
shopping list still refreshes the moment a shake lands: the widgets are
views over the page's data, not independent fetchers.

### Resizing the meal plan's columns

Drag the divider on any column header to change its width. A drag grows the
column on its left and shrinks the one on its right by the same amount, so the
table's overall width never moves and the columns further right stay where
they are. Nothing can be dragged below 72px.

Double-click a divider — or focus one and press Enter — to put every column
back to its default. The dividers are keyboard operable: Tab to one, then
Left/Right to nudge, Shift for a bigger step.

Widths are saved in `localStorage`, not the database, which is deliberate.
The right column width depends on how wide the window is, so a value synced
from a desktop to a phone would be actively wrong. They are also stored
separately per column set, since turning the calendar overlay on adds a fifth
column and widths chosen for four should not be reinterpreted as widths for
five. Handles are hidden below the mobile breakpoint, where the table scrolls
horizontally instead.

### Add, hide, reorder

**Edit layout** reveals per-widget controls; **Add widget** offers anything
not currently on the board.

**Hiding a widget deletes nothing.** It removes a view. Meals, ticked
ingredients, recipes and calendar connections are all untouched, and adding
the widget back restores it exactly as it was. The button is labelled
*Hide* rather than *Remove* for that reason.

Drag-and-drop is never the only way to work the board. Every widget's header
carries **↑** and **↓** buttons that swap it with its neighbour in reading
order, so the whole dashboard is operable from the keyboard; each widget is
also a labelled `role="region"` landmark. Dragging (by the title bar) and
resizing (by the bottom-right corner) are conveniences on top.

### How layouts persist

One row per user in a `dashboard_layouts` table, keyed by `user_id` as the
primary key, holding the arrangement as JSON. Reads and writes go through
`GET`/`PUT`/`DELETE /api/dashboard/layout`.

**The owner always comes from the session.** No verb on that route reads a
user id from the query string, body or headers — there is no admin view of
somebody else's board and no cross-user read, so passing `?userId=…` simply
returns your own layout. A user who has never rearranged anything has no
row at all and lands on the shipped default arrangement, not an empty
canvas. **Reset to default** deletes the row rather than writing today's
default into it, so a later change to the shipped default still reaches
everyone who never customised theirs.

### Stale layouts never blank the page

Every read runs through `reconcileLayout()`, which is the reason the widget
registry can change shape without touching stored data:

- an item naming a widget that no longer exists is **dropped**;
- a widget added in a later release that the stored layout has never heard
  of is **appended** at the bottom at its default size — unless the user
  removed it on purpose, which is tracked separately in `hidden` so
  "I hid this" and "this didn't exist yet" stay distinguishable;
- nonsense geometry (NaN, negative, wider than the grid, below a widget's
  own minimum) is **clamped**, not rejected;
- unparseable JSON, or no row, falls back to the default layout.

Hiding *every* widget is allowed and shows an explicit empty state with a
reset button — which is a different thing from a blank screen.

### On a phone

Below the `md` breakpoint (768px) the board **stops being a grid**. Widgets
render as a plain stacked list in reading order, full width, with nothing
draggable — a 12-column drag-and-drop grid at 375px is a way to bury one
widget under another, not a feature. The ↑ ↓ and Add/Hide controls still
work, so the board is still configurable there. Reading order comes from
the saved desktop geometry, so a board you arranged on a laptop reads the
same way on your phone.

### No flash on load

`react-grid-layout` is client-only and is loaded with
`dynamic(..., { ssr: false })`. Rather than leaving a hole (or a spinner)
until that chunk arrives, the server renders the *same* board from the same
saved geometry using plain CSS `calc()` — transcribing react-grid-layout's
own width formula, so no measurement is needed and the grid swaps in on top
of an already-correct picture. The same markup collapses to the stacked
list at narrow widths via a media query, so the phone rendering is correct
before hydration too.

The grid's chunk is about **17.6 kB gzipped** and is fetched only after the
dashboard mounts, and only at desktop widths — it is not part of `/plan`'s
initial JS.


## How migrations work

Schema is defined in `src/db/schema.ts`. Running `npm run db:generate`
(via drizzle-kit) produces SQL migration files under `./drizzle`, which are
committed to the repo.

Migrations are applied in two places, both idempotent:

1. **Automatically at runtime** — `src/db/index.ts` is the single shared
   database module. The first time it's imported in a given process, it
   opens the SQLite file (creating the `./data` directory if needed) and
   runs any pending migrations from `./drizzle` before handing back the
   Drizzle client. This means a fresh `npm run dev` or a fresh container
   start always has an up-to-date schema without a manual step.
2. **Explicitly via a script** — `npm run db:migrate` (`scripts/migrate.mjs`)
   does the same thing standalone, and is what the Docker image runs before
   starting the server (`scripts/start.js` runs the migration script, then
   starts `server.js`).

To change the schema: edit `src/db/schema.ts`, run `npm run db:generate`,
commit the new file(s) under `./drizzle`, and redeploy — migrations apply
automatically on the next startup.

A generated migration is DDL only. When a change needs **data** carried
across, the backfill is hand-appended to the generated `.sql` so it runs in
the same automatic path as everything else — see `0002_*.sql` (the
`is_global_admin` backfill) and `0011_*.sql`, which splits the old
comma-separated `recipes.tags` column into the `tags` / `recipe_tags`
tables before `0012_*.sql` drops the column.


## Project structure

```
src/
  app/                     App Router pages & API routes
    (app)/                 Authenticated pages (plan, recipes, admin, reports) — protected via a server layout
    api/                   Route handlers (auth, recipes, plan, export, admin, reports)
    login/, signup/        Public auth pages
  components/               React (mostly client) components: forms, navbar, plan view, shopping
                              list panel, theme toggle, admin table, reports view
    ui/                      The shared pieces every screen is built from: Sheet (a bottom sheet
                              on a phone, a dialog at a desk), ListRow, Chip
    plan/                    The dashboard: widgets, PlanContext, the slot picker sheet
    recipes/                 Recipe tiles and table, filters, the bulk confirmation
  db/                        Drizzle schema + the shared DB client/migration runner
  lib/                       Auth config, validators, mail (SMTP, DB settings + env fallback),
                              crypto.ts (AES-256-GCM encrypt/decrypt for the stored SMTP
                              password), date helpers (Sunday-start week math), plan/shake logic,
                              shoppingList.ts (ingredient aggregation + on-hand status),
                              permissions.ts (role/scope checks), tags.ts + tagNames.ts (tag
                              vocabulary, lookups and the permission-scoped tag edits),
                              planContext.ts (per-request
                              scope+userId resolution), audit.ts (audit_log writer), reports.ts,
                              recipeQuery.ts (the Recipes page's search/filter/sort/paging, in SQL),
                              viewerToday.ts (today in the viewer's own time zone),
                              favorites.ts, pickerChips.ts
  types/                     Ambient type augmentation (NextAuth session)
scripts/                    migrate.mjs (migration runner), start.js (container entrypoint), seed.ts
drizzle/                    Generated SQL migrations (drizzle-kit)
```

