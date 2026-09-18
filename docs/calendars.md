# Calendars

How Pickl pushes planned meals into your own calendar, and how it reads your
events back onto the plan. Part of [Pickl](../README.md).

## Calendar sync

Planned meals can be mirrored into a real calendar, so meals show up
alongside everything else in your day. Two providers are supported:

| Provider | Auth | Server-side setup |
| --- | --- | --- |
| **Google Calendar** | Per-user OAuth | An admin must register an OAuth client once (below) |
| **CalDAV** (Fastmail, iCloud, Nextcloud, Synology, Baikal, Radicale…) | Per-user username + app password over HTTPS | None |

A user can connect **either or both**, though each plan has at most one
target — so you might mirror the household plan to Google and your private
plan to Fastmail, but not one plan to both at once.

**No new environment variables are needed for either provider.** All
credentials are per-user rows in the database, encrypted at rest with the
existing `NEXTAUTH_SECRET`-derived key (`src/lib/crypto.ts`). The Google
OAuth *client* credentials are configured through the admin UI, not the
environment.

**Each user connects their own account** and mirrors the plans they
care about into a calendar of their own choosing. There is no app-owned or
admin-owned "household calendar" — the household plan is mirrored
separately into each participating person's calendar. So one user can have
up to two sync targets:

| Plan | What it mirrors |
| --- | --- |
| **Household plan** | The shared household plan, into a calendar of that user's choosing. |
| **My private plan** | That user's own private plan. |

Users manage all of this from **Preferences → Calendars**.

### Admin setup: the OAuth client (one-time, per deployment)

The only calendar setting an administrator owns is the Google OAuth
**client** credentials — deployment plumbing, the same category as SMTP.
Configured under **Admin → Calendar Integration**.

1. In the [Google Cloud console](https://console.cloud.google.com/),
   create (or pick) a project.
2. Enable the **Google Calendar API** for that project.
3. Create an **OAuth client ID** of type **Web application**.
4. Add this app's redirect URI to that client's *Authorized redirect
   URIs*:

   ```
   {APP_BASE_URL}/api/calendar/google/callback
   ```

   The exact value is shown as copyable text on the admin panel, computed
   from this server's configured base URL — copy it from there rather than
   assembling it by hand.
5. Paste the **client ID** and **client secret** into the admin panel,
   tick **Enable Google Calendar sync**, and save.
6. On the **OAuth consent screen**, set the publishing status to **In
   production**. Read the warning below before skipping this.

> **⚠️ Leaving the consent screen in "Testing" expires everyone's
> authorization after about 7 days**, forcing every person in the
> household to reconnect weekly. Publishing to **In production** fixes it.
> For a private household app this does *not* mean going through Google's
> formal verification review — it just means each person accepts a
> one-time "Google hasn't verified this app" warning the first time they
> connect. If users keep seeing "Reconnect your Google account", this is
> almost always why.

#### The redirect URI must match your deployment's base URL

The redirect URI is derived from `APP_BASE_URL` (falling back to
`NEXTAUTH_URL`). Whatever those are set to **must** match the URL people
actually visit *and* the URI registered in Google Cloud, or Google rejects
every connection attempt with `redirect_uri_mismatch`. If you move the app
to a new hostname, update the env var *and* add the new redirect URI in
Google Cloud.

### Connecting a Google account (each user, from Preferences → Calendars)

1. Click **Connect Google Calendar** and complete Google's consent screen.
2. Pick a target calendar for the **Household plan**, the **My private
   plan**, or both — or leave either on **Don't sync**.
3. Optionally tick **include recipe details** per target, and use **Sync
   now** to reconcile the current week.

The app requests the narrowest scopes that do the job:
`calendar.events` (manage the events it creates), `calendar.calendarlist.readonly`
(so you can pick which of your calendars to target), and `openid email`
(to label the connection). Notably it does **not** request the broad
`calendar` scope.

`calendar.events` covers both writing meals out and — only if you opt in
to the overlay below — reading that week back. Turning the overlay on
therefore needs **no re-consent and no new scopes**; nobody who has already
connected has to reauthorize.

### Connecting a CalDAV server (each user, from Preferences → Calendars)

1. Enter your **server URL**, **username** and **app password**, then
   click **Connect**. Pickl performs RFC 6764 service discovery (well-known
   URL → principal → calendar home) and lists the calendars on that account
   that can hold events.
2. Pick a target calendar per plan, exactly as with Google.

Where to find the URL, and which providers force an app password:

| Provider | CalDAV URL | Password |
| --- | --- | --- |
| Fastmail | `https://caldav.fastmail.com/` | **App password required** — Settings → Privacy & Security → Integrations → App passwords, with CalDAV access |
| iCloud | `https://caldav.icloud.com/` | **App-specific password required** — account.apple.com → Sign-In and Security. Username is your Apple ID email |
| Nextcloud | `https://your-server/remote.php/dav/` | Account password works; use a device password (Settings → Security) instead |
| Synology Calendar | `https://your-nas:5001/caldav/` | Your DSM account |

Two rules worth knowing before you type anything in:

- **Use an app-specific password, never your main account password.**
  CalDAV authenticates with HTTP Basic, so the password has to be stored in
  a recoverable (encrypted, not hashed) form to be replayed on every
  request. Give Pickl a credential you can revoke on its own. iCloud and
  Fastmail require one anyway.
- **HTTPS only.** A plain `http://` server URL is rejected outright,
  because Basic auth would put your password on the wire in the clear. The
  single exception is a loopback host (`localhost`, `127.0.0.1`, `::1`) in
  a *non-production* build, so a local CalDAV server can be tested without
  minting certificates — it is off in the Docker image, which runs with
  `NODE_ENV=production`, and needs no environment variable to keep it that
  way.

Pickl also refuses server URLs that resolve to private, loopback or
link-local addresses (RFC1918, CGNAT, IPv6 ULA, `169.254.0.0/16` and
friends), and re-checks that on every redirect hop, because the server is
fetching a URL the user supplied. See `src/lib/calendar/caldavUrl.ts`.

**Disconnecting** deletes the stored server address and encrypted
password along with any targets using them. There is nothing to revoke
remotely — revoke the app password in your provider's own settings.

### What gets pushed

- Events are **title only by default** — e.g. `Dinner: Spaghetti
  Bolognese`. Ingredients and instructions never leave the app unless the
  user ticks **"Include recipe details"** on that specific target.
- Event times reuse the same per-meal default hours as the iCal export
  (breakfast 08:00, lunch 12:00, dinner 18:00, 1 hour long), so pushed
  events line up with exported ones.
- Pushes happen automatically whenever a meal is planned, changed, or
  cleared — every plan write goes through `setPlanEntry`, the single write
  path. A **private** write reaches only its owner's private target; a
  **household** write **fans out** to every user who has an enabled
  household target.
- Because a full-week shake in a four-person household is now dozens of
  writes, pushes are not fired unthrottled: targets run in parallel and
  each target's own work is capped at a small concurrency limit. Google's
  batch endpoint is deliberately *not* used — every target authenticates
  as a different user, so a single batch could not span the fan-out
  anyway.
- **A calendar outage can never break meal planning.** The push is
  detached from the request and fully non-fatal: if Google is down, a
  CalDAV server is unreachable, or a stored credential has stopped
  working, the shake/edit still succeeds and the
  failure is recorded per target in `lastSyncError`, shown on that user's
  Preferences → Calendars panel. **Sync now** is the recovery path — it
  reconciles the whole current week for one target.
- A `calendar_event_links` row maps each (target, date, meal) to the event
  the provider holds, so re-planning a meal **updates** that event rather
  than creating duplicates. If the event has been deleted in Google
  Calendar, the next push creates a fresh one.
- For CalDAV there is no server-assigned event id: the resource URL is
  derived from a **stable UID** hashed from (target, date, meal). So even
  if a link row is lost — an older backup, say — the next push addresses
  the same resource and overwrites it instead of double-booking the meal.
- CalDAV writes are **conditional** (`If-Match` / `If-None-Match`) using
  the ETag from the last write. An event you edited by hand in your own
  calendar app is still *updated* when the plan changes (the plan is the
  source of truth for what is scheduled), but it is **never deleted** out
  from under you: clearing that slot reports the conflict in
  `lastSyncError` and leaves your edited event alone.
- Every CalDAV request carries a hard timeout, and a whole discovery walk
  shares one budget, so a hung server cannot hold a request open or leak
  an unsettled promise into the detached push path.
- **Disconnect** deletes the stored authorization, both sync targets and
  all event links, and (for Google) **revokes the refresh token** so a
  stolen database backup cannot be replayed later. It deliberately **leaves
  already-created events in the remote calendar** — silently wiping a month of
  someone's calendar would be surprising. Delete them yourself if you want
  them gone.
- Turning **Sync enabled** off on a target keeps it configured but stops
  all pushes to it.

## Calendar read-back (seeing your own events on the plan)

Sync pushes meals *out*. Read-back brings the rest of your week *in*: with
it switched on, the plan grid grows one more column — **On your
calendar** — showing your own events beside the meal slots, so you can see
the soccer practice before you plan a roast.

It is **off by default** and each person turns it on for themselves under
**Preferences → Calendars → Show my calendar on the plan**.

- **Google Calendar only, for this release.** CalDAV connections still
  receive your meals; they cannot be read back yet. Doing it properly needs
  a `calendar-query` REPORT plus client-side recurrence expansion, and a
  half-correct implementation would quietly show people the wrong week. The
  CalDAV provider therefore reports "not supported" explicitly, and a
  CalDAV-only user sees a one-line explanation instead of an error.
- **Events are never stored.** Not titles, not times, not attendees — no
  external event data reaches the database in any table. Each request
  fetches the displayed week, renders it, and drops it. The only retention
  is a ~60-second in-memory cache, keyed by user, calendar and week, that
  dies with the process. Event titles are never written to the log either.
- **The overlay is per-viewer, never shared.** The household plan is
  shared; the events drawn on it are not. Two people looking at the same
  household week each see their own calendar and never each other's.
- **Administrators get nothing extra.** An admin may view a member's
  private plan, but that view carries no calendar overlay at all — enforced
  server-side in `src/lib/calendar/read.ts`, not merely hidden in the UI.
- **Opting out stops the reading, not just the drawing.** With the switch
  off, no request is made to any calendar provider.
- **Pickl's own pushed meals are filtered out** so a planned dinner never
  appears twice — once as a meal slot and once as an "event". Three signals
  do it: a private extended property Pickl writes on every event it
  creates, the `pickl-` UID prefix used by CalDAV-pushed events, and the
  event ids in `calendar_event_links` for that viewer's own targets.
- **Recurring events are expanded by Google** (`singleEvents=true`) rather
  than by us. All-day and multi-day events are handled as such; a
  three-day trip shows on all three days.
- **A failed read can never break the plan.** The grid is rendered by the
  server without waiting on any calendar; the overlay is fetched afterwards
  and dropped in when it arrives. If the read fails, times out (5s hard
  ceiling) or the stored token is dead, the grid still renders in full and
  the only symptom is a quiet inline line — "Couldn't load your calendar
  events." A dead token reuses the **existing** reconnect signal that the
  push path already sets, so you get one "Reconnect your Google account"
  banner rather than two competing ones.

### Trust boundary

- **Administrators cannot see or operate another user's calendar
  connection** — not in the UI, and not through any API. There is
  deliberately no admin override: every calendar endpoint derives the
  owner from the server-side session and never accepts a user id from the
  client, and the data-access helpers in `src/lib/calendar/accounts.ts`
  all scope their queries by that user id. The same holds for CalDAV: the
  stored server password is decrypted only inside the outbound request
  path and is never returned by any endpoint — the settings API exposes a
  `hasPassword` boolean, and leaving the field blank keeps the saved one.
  Per-user credentials are the main reason the app moved off a shared
  service account in the first place.
- **Refresh tokens, CalDAV passwords and the OAuth client secret are all
  encrypted at rest**
  (AES-256-GCM, same mechanism as the SMTP password — see
  `src/lib/crypto.ts`) and are never sent back to the browser in any form,
  masked or otherwise. The admin form shows a placeholder when a secret is
  stored, and leaving it blank on save keeps the existing one.
- Be clear-eyed about what that protects against: **an admin who controls
  the deployment or the database file can inherently reach the stored
  credentials.** Encryption at rest protects the DB file at rest; the
  app-level rules prevent casual in-app access. Neither stops a determined
  operator of the server.
- The OAuth `state` parameter is cryptographically random, bound to the
  initiating session's user, stored server-side, **single-use** and
  short-lived. A callback whose state is missing, unknown, expired,
  already consumed, or minted for a different user is rejected before the
  authorization code is ever exchanged — so a callback can never attach a
  Google account to a user who did not start the flow.
- `audit_log` records connect / disconnect / target changes and manual
  syncs. It never records tokens, client secrets, or event contents.
- **Rotating `NEXTAUTH_SECRET` breaks decryption of the stored refresh
  tokens and OAuth client secret**, exactly as it does for the stored SMTP
  password, since the encryption key is derived from it. After rotating,
  the admin must re-enter the client secret and every user must reconnect
  their Google account from Preferences → Calendars.

