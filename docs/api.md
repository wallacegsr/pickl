# The Pickl API

A small JSON API under `/api/v1`, built for Home Assistant but usable from
anything that can send an HTTP request: show tonight's dinner on a dashboard,
let a voice assistant pick a meal, tick items off the shopping list from a
phone widget, or put the plan on a wall calendar.

## Turning it on

API access is **off** for every household until a household admin turns it on
under **Back of House → Household → Home Assistant & API**. The same form sets
the household's **time zone**. The API uses that zone to work out "today" and
the times in the calendar feed, because, unlike a browser, Home Assistant does
not tell Pickl where it is. Leave it unset and the server's own zone is used.

Turning API access off stops every token in the household straight away.
Turning it back on brings them back.

## Tokens

Each person makes their own tokens under **Preferences → API tokens**. A token
acts as the person who made it and can do nothing they couldn't do in the
browser:

- it sees only their household
- private recipes stay private
- someone without access to the shared calendar can't use it through a token
  either

Deactivating a user, moving them to another household, or the token passing
its expiry date stops the token.

| Access            | Can                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------- |
| Read only         | Every `GET` below except the calendar feed.                                               |
| Read and change   | All of that, plus deciding meals, filling the week, and ticking or adding shopping items. |
| Calendar feed     | Only `calendar.ics`. Meant to be pasted into a calendar app as a link.                    |

A token is shown once when it's made. Pickl stores only a SHA-256 fingerprint of
it, so a lost token can't be recovered. Revoke it and make another. Each person
can have up to 20.

Send it in a header:

```
Authorization: Bearer pkl_…
```

The API never accepts a browser session cookie, and the JSON endpoints never
accept a token in the URL. Only the calendar feed does that (as `?key=`),
because calendar apps can't send headers. A feed key opens the feed and
nothing else, so a link that ends up somewhere it shouldn't exposes no more
than the calendar.

### Errors and limits

Errors are JSON, `{ "error": "…" }`, with the usual status:

| Status | Meaning                                                                                         |
| ------ | ----------------------------------------------------------------------------------------------- |
| `400`  | Bad input: an impossible date, an unknown meal type, an empty item.                             |
| `401`  | No token, or a token that's wrong, revoked or expired, or whose owner has been deactivated.     |
| `403`  | The token's access doesn't cover this, or API access is off for the household.                  |
| `404`  | Not found, or not visible to this token's owner. The two are deliberately indistinguishable.    |
| `409`  | `decide-today` found the meal already planned. See below.                                       |
| `429`  | More than 120 requests a minute on one token. `Retry-After` says when to try again.             |

Twenty failed attempts from one address in fifteen minutes lock that address out
for the rest of the window. No response is cached (`Cache-Control: no-store`).

### Common parameters

- **`date`**: `YYYY-MM-DD`. Defaults to today in the household's time zone.
- **`scope`**: `shared` (the household calendar, the default) or `private` (the
  token owner's own calendar).

Recipe and shopping-list `url` fields are links to the matching page in Pickl,
built from `APP_BASE_URL`.

## Reading

### `GET /api/v1/status`

Checks a token and shows what it's attached to.

```json
{
  "app": "pickl",
  "version": "2.6.1",
  "household": "Alder",
  "user": "Alder Admin",
  "token": { "name": "Home Assistant", "scope": "read" },
  "time_zone": "America/New_York",
  "today": "2026-10-28"
}
```

### `GET /api/v1/meals?date=&scope=`

One day. `breakfast`, `lunch` and `dinner` are display strings: several recipes
in a slot are joined with " & ", and `null` means nothing is planned. They are
what a sensor's state wants. `meals` has the detail.

```json
{
  "date": "2026-10-28",
  "day_of_week": "Wednesday",
  "is_today": true,
  "scope": "shared",
  "breakfast": null,
  "lunch": "Pork Stew",
  "dinner": "Tomato Soup",
  "meals": {
    "breakfast": [],
    "lunch": [{ "id": "…", "name": "Pork Stew", "is_dessert": false, "prep_minutes": 18, "cook_minutes": 23, "total_minutes": 41, "servings": 4, "url": "https://pickl.example/recipes/…" }],
    "dinner": [{ "id": "r-soup", "name": "Tomato Soup", "…": "…" }]
  }
}
```

### `GET /api/v1/plan/week?date=&scope=`

The Sunday–Saturday week containing `date`. Each entry in `days` has the same
shape as `/meals`, plus `is_past`. `unplanned_remaining` counts the empty slots
from today to the end of the week, per meal, which is handy for an "nothing
planned for Thursday" automation.

```json
{
  "week_start": "2026-10-25",
  "week_end": "2026-10-31",
  "today": "2026-10-28",
  "scope": "shared",
  "unplanned_remaining": { "breakfast": 3, "lunch": 0, "dinner": 1 },
  "days": [{ "date": "2026-10-25", "day_of_week": "Sunday", "is_past": true, "is_today": false, "breakfast": null, "lunch": null, "dinner": "Tomato Soup", "meals": { "…": "…" } }]
}
```

### `GET /api/v1/recipes`

Search the recipe jar. All parameters are optional.

| Parameter     | Meaning                                                                        |
| ------------- | ------------------------------------------------------------------------------ |
| `q`           | Search text; comma-separated terms must all match.                             |
| `tag`         | A tag name. Repeat it for several.                                             |
| `match`       | `all` (default) or `any`: how several tags combine.                            |
| `meal`        | `breakfast`, `lunch`, `dinner` or `dessert`. Repeat it for several.            |
| `favorites`   | `true` for the token owner's starred recipes only.                             |
| `max_minutes` | Total time at most this.                                                       |
| `jar`         | `shared` (the House Jar, default) or `mine` (the owner's Secret Stash).        |
| `limit`       | 1–50, default 20.                                                              |

```json
{
  "total": 49,
  "count": 1,
  "recipes": [{ "id": "…", "name": "Beef Bake", "meal_types": ["dinner"], "tags": ["Weeknight"], "favorite": false, "total_minutes": 45, "last_planned": null, "url": "…" }]
}
```

### `GET /api/v1/recipes/{id}`

One recipe, with the ingredients as a list and the method split into steps, the
same way the recipe page shows them.

```json
{
  "id": "r-soup",
  "name": "Tomato Soup",
  "jar": "shared",
  "meal_types": ["lunch"],
  "tags": [],
  "prep_minutes": 10,
  "cook_minutes": 30,
  "total_minutes": 40,
  "servings": 4,
  "ingredients": ["1kg tomatoes", "1 onion"],
  "steps": ["Roast.", "Blend."],
  "source_url": null,
  "url": "…"
}
```

### `GET /api/v1/shopping-list?date=&scope=`

The week's shopping list. It has the ingredients of every planned recipe, then
anything added by hand. `to_buy` counts what isn't ticked off yet. Item ids
are stable for as long as the plan doesn't change. A recipe line's id starts
`r_`, an added item's `x_`.

```json
{
  "week_start": "2026-10-25",
  "scope": "shared",
  "to_buy": 15,
  "total": 18,
  "items": [
    { "id": "r_2026-10-26_FlOKXTvuMLTAt_wL", "text": "1kg tomatoes", "on_hand": false, "source": "recipe", "date": "2026-10-26", "meal_type": "dinner", "recipe": { "id": "r-soup", "name": "Tomato Soup" } },
    { "id": "x_2bdbd505-…", "text": "Bin bags", "on_hand": false, "source": "extra", "date": null, "meal_type": null, "recipe": null }
  ]
}
```

### `GET /api/v1/calendar.ics?key=&scope=`

An iCalendar feed of the plan from a week ago to three weeks ahead, for Home
Assistant's **Remote Calendar** integration or any calendar app that subscribes
to a link. It needs a **Calendar feed** key. Each meal is an hour long, at
08:00, 12:00 or 18:00 in the household's time zone, and links to its recipe.

The **Calendar feed** option in Preferences gives the whole link, ready to
paste.

## Changing things

These need a **Read and change** token. Everything they do shows in Past
Preserves' audit log as done by the token's owner, `via API token "…"`.

### `POST /api/v1/plan/decide-today`

Picks today's meal, like 🥒 Crunch Time. The body is optional:

```json
{
  "meal_type": "dinner",
  "include_dessert": false,
  "tags": ["Quick"],
  "tag_match": "all",
  "favorites_only": false,
  "overwrite": false,
  "scope": "shared"
}
```

`meal_type` defaults to `dinner`. Send `meal_types` (a list) to decide several
at once. If any of them is already planned, nothing changes unless `overwrite`
is `true`:

```json
{ "error": "Already planned (dinner: Tomato Soup). Send \"overwrite\": true to replace it.", "planned": [{ "meal_type": "dinner", "recipes": ["Tomato Soup"] }] }
```

The answer to a successful call has a one-line `message` meant for speaking or
a notification:

```json
{
  "date": "2026-10-28",
  "message": "dinner: Chicken Tacos",
  "results": [{ "meal_type": "dinner", "recipe": { "id": "…", "name": "Chicken Tacos" } }],
  "note": null
}
```

`note` explains when the filters left nothing to choose from.

### `POST /api/v1/plan/fill-week`

Fills the empty slots from today to Saturday, like 🫙 Weekly Picks. It takes the
same body, but with `meal_types` (default `["dinner"]`) instead of `meal_type`.
With `overwrite: true` it replaces what's already planned too.

```json
{
  "filled": 3,
  "unfilled": 0,
  "message": "Planned 3 meals.",
  "filled_slots": [{ "date": "2026-10-29", "meal_type": "dinner" }],
  "note": null
}
```

### `POST /api/v1/shopping-list`

Adds an item to the week's list: `{ "text": "Oat milk", "date": "…", "scope": "…" }`.
`date` is any day in the week and defaults to today. The new item comes back
with `201`.

### `PATCH /api/v1/shopping-list/items/{id}`

Ticks an item off, or back on: `{ "on_hand": true }`. This works for recipe
lines and added items alike. `POST` does the same, for tools that can only
send `POST`. Pass `?scope=private` for an item on the owner's own list.

### `DELETE /api/v1/shopping-list/items/{id}`

Removes an added item. A recipe's ingredient can't be deleted, only ticked off.
To drop it, change the plan.

## Home Assistant

Put the token in `secrets.yaml`:

```yaml
pickl_token: "Bearer pkl_…"
```

### Tonight's dinner as a sensor

```yaml
# configuration.yaml
rest:
  - resource: https://pickl.example/api/v1/meals
    headers:
      Authorization: !secret pickl_token
    scan_interval: 900
    sensor:
      - name: "Dinner tonight"
        unique_id: pickl_dinner_tonight
        value_template: "{{ value_json.dinner or 'Nothing planned' }}"
        json_attributes_path: "$.meals"
        json_attributes:
          - dinner
      - name: "Lunch today"
        unique_id: pickl_lunch_today
        value_template: "{{ value_json.lunch or 'Nothing planned' }}"

  - resource: https://pickl.example/api/v1/shopping-list
    headers:
      Authorization: !secret pickl_token
    scan_interval: 900
    sensor:
      - name: "Shopping list to buy"
        unique_id: pickl_shopping_to_buy
        value_template: "{{ value_json.to_buy }}"
        unit_of_measurement: items
        json_attributes:
          - items
```

### Buttons and voice: decide dinner, add to the list

```yaml
rest_command:
  pickl_decide_dinner:
    url: https://pickl.example/api/v1/plan/decide-today
    method: POST
    headers:
      Authorization: !secret pickl_token
    content_type: application/json
    payload: '{"meal_type": "dinner"}'

  pickl_add_item:
    url: https://pickl.example/api/v1/shopping-list
    method: POST
    headers:
      Authorization: !secret pickl_token
    content_type: application/json
    payload: '{"text": {{ item | tojson }}}'
```

A script that decides and says what it picked:

```yaml
script:
  decide_dinner:
    sequence:
      - action: rest_command.pickl_decide_dinner
        response_variable: pickl
      - action: notify.notify
        data:
          message: >-
            {% if pickl.status == 200 %}Tonight: {{ pickl.content.results[0].recipe.name }}
            {% else %}{{ pickl.content.error }}{% endif %}
      - action: homeassistant.update_entity
        target:
          entity_id: sensor.dinner_tonight
```

### The plan on a calendar

Make a **Calendar feed** token. Add the **Remote Calendar** integration in Home
Assistant, then paste the link Pickl shows. Meals appear as events on the
calendar card, and automations can trigger on them like any other calendar.
