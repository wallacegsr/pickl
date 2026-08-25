# Security policy

Pickl is a self-hosted household app. There is no hosted service and no
vendor — every deployment is run by the person who installed it, so
"security" here mostly means: what the app protects, what it cannot, and
where to tell us when something is wrong.

## Reporting a vulnerability

Please report suspected vulnerabilities **privately** rather than opening a
public issue, so deployments can be updated before details circulate.

- Use GitHub's [private vulnerability reporting][gh-private] on this
  repository (Security → Report a vulnerability), or
- open a public issue containing **only** "security issue, please advise"
  and no details, and wait to be contacted.

[gh-private]: https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability

This is a hobby project maintained in spare time. Expect an acknowledgement
in a week or two, not in hours, and please don't treat it as an SLA.

## Supported versions

The `main` branch is the only supported version. There are no backported
security releases; fixes land on `main` and you redeploy.

## What the app does protect

- **Passwords** are hashed with bcrypt and never stored or logged in plain
  text.
- **Third-party credentials at rest** — the SMTP password, Google OAuth
  refresh tokens, the Google client secret, and CalDAV app passwords — are
  encrypted with AES-256-GCM using a key derived from `NEXTAUTH_SECRET`
  (`src/lib/crypto.ts`). No endpoint ever returns them to the browser.
- **Authorization is enforced server-side**, in the route handlers, not
  hidden in the UI. Endpoints derive the acting user from the session and
  never accept a user id from the request body.
- **Calendar connections are per-user and admin-invisible.** An admin can
  view a member's meal plan, but has no path — UI or API — to that member's
  connected calendar, its credentials, or its events.
- **External calendar events are never persisted.** They are fetched per
  request, cached in memory briefly, and rendered transiently.
- **OAuth state** is single-use, expiring, bound to the initiating session,
  and stored server-side, so a callback cannot attach a Google account to a
  user who did not start the flow.
- **CalDAV server URLs are validated against SSRF**: HTTPS only, no embedded
  credentials, and every resolved address is checked against loopback,
  RFC1918, CGNAT, link-local (including cloud instance metadata) and IPv6
  ULA ranges — on the initial request and on every redirect hop. Credentials
  are never sent across a cross-origin redirect.

## What it does not protect against

Being straight about the boundaries matters more than a longer list above.

- **Whoever runs the deployment can read everything.** The SQLite file and
  `NEXTAUTH_SECRET` live on the host, so anyone with host or file access can
  decrypt stored credentials. The admin lockout on members' calendars is an
  application boundary, not a cryptographic one.
- **There is no rate limiting** on login or any other endpoint. If you
  expose Pickl to the public internet, put it behind a reverse proxy that
  provides throttling.
- **Pickl does not terminate TLS.** Run it behind a proxy that does. Auth
  cookies assume HTTPS in production.
- **A DNS-rebinding race remains theoretically possible** in CalDAV
  validation: the address is checked at resolve time, and `fetch` does not
  let us pin the socket to it.
- **Email deliverability and SMTP transport security** are your provider's
  concern. Use an app-specific password, never your primary one.

## Deployment advice

- Generate a strong, unique `NEXTAUTH_SECRET` and treat it like a password.
  Rotating it invalidates every stored credential — SMTP settings and every
  user's calendar connection would need re-entering.
- Keep `AUTH_TRUST_HOST=true` only because a reverse proxy sits in front.
- Back up the `/data` volume. It is the entire application state.
- The first account to sign up becomes that deployment's permanent global
  admin, **and is created already email-verified**, so a broken SMTP config
  cannot lock you out of your own deployment. Verification proves control of
  an address, which is meaningful when joining an existing household; on an
  empty deployment there is nobody to impersonate, and an attacker who signed
  up first would simply verify their own address instead. The real control is
  to create this account yourself, before the app is reachable by anyone else.
  Every subsequent account still requires verification.
