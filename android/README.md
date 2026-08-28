# Pickl for Android

A thin native shell around your own Pickl server. On first launch it asks for a
server address, checks that the address really is a Pickl server, and from then
on opens straight into the app.

It is **not** a rewrite of the UI and it holds no data of its own. The only
thing it stores is which server to talk to.

## Why a WebView and not a native app

The WebView loads pages from your server's own origin, so the existing session
cookie works with no changes: no bearer tokens, no second API surface, and no
duplicate copy of the interface to keep in step with the web app. Every feature
Pickl gains on the web appears here the moment you redeploy the server.

A Trusted Web Activity (the usual way to package a web app for Play) was ruled
out deliberately: a TWA is cryptographically pinned to one domain through
Digital Asset Links, and this app has to point at whatever host you run.

## Requirements

Your server must be reachable over **HTTPS with a certificate the phone
trusts** — for example Let's Encrypt via a Synology DSM reverse proxy, a
Cloudflare Tunnel, or Tailscale with MagicDNS certificates.

Plain `http://` is refused, and the app will not offer to skip certificate
validation. Both are deliberate: the session cookie is a bearer credential, and
an app that ignores TLS errors hands it to anyone on the same network. A
self-signed certificate will be reported as a certificate failure, not silently
accepted.

## Building

The Gradle wrapper JAR is intentionally not committed. Either:

- **Android Studio** — open the `android/` folder; it generates the wrapper and
  syncs automatically.
- **Command line** — with Gradle 8.7+ and JDK 17 installed:

```bash
cd android && gradle assembleDebug
```

The APK lands in `app/build/outputs/apk/debug/`.

CI builds a debug APK on every push touching `android/`, and attaches a
**signed release APK** to the GitHub release when you push a `v*` tag *and*
these repository secrets exist:

| Secret | Contents |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | your keystore, base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key password |

Without them the release steps are skipped and the debug APK is still produced,
so forks and PRs are never broken by missing signing material.

To create a keystore:

```bash
keytool -genkey -v -keystore pickl.jks -keyalg RSA -keysize 2048 -validity 10000 -alias pickl
```

Keep that file and its passwords safe and out of the repository (`*.jks` is
gitignored). Losing it means you cannot ship an update that upgrades an
installed copy — Android requires the same signing key.

## Installing

Sideload the APK: transfer it to the phone and open it, allowing installs from
your file manager when prompted. Play Store distribution is possible but not
required, and sideloading is the normal route for self-hosted software.

### Updating a debug build requires uninstalling first

Gradle creates a debug keystore on whatever machine performs the build, so
every CI run signs with a **different** debug key. Android refuses to install
over an app signed by another key, and reports it only as "App not installed"
or a signature mismatch. Uninstall the old copy first; you lose the stored
server address and your session, nothing else.

Set up release signing (above) to make this go away — release builds use one
stable key, so they update in place like any normal app.

## Which build am I running?

The version name carries the commit it was built from:

```
1.0.0-debug-4700ea7    debug build of commit 4700ea7
1.0.0-4700ea7          signed release of the same commit
```

Visible in Android's Settings → Apps → Pickl, and on the connect screen — which
is where you land after "Change server" or when a server cannot be reached, so
it is readable exactly when it matters. Without it a stale sideloaded install
and a current one are indistinguishable, since there is no store listing or
update channel to compare against.

The SHA resolves from `-PbuildSha`, then CI's `GITHUB_SHA`, then the local git
checkout, and finally `local` — a missing SHA never fails the build.

## What the shell handles

A bare WebView gets several things wrong; these are covered explicitly:

- **DOM storage is enabled.** Pickl keeps the theme, sidebar state and column
  widths in `localStorage` and reads them in a pre-hydration script. Left at the
  default, dark mode silently fails to persist.
- **Downloads are forwarded to Android's DownloadManager,** with the session
  cookie copied across. DownloadManager runs in a separate process with an
  empty cookie jar, so without that every export would follow the redirect to
  `/login` and save the login page instead of the file.
- **Off-site links open in the system browser,** so a link out of the app is
  never a dead end with no way back.
- **Back navigates the site** rather than closing the app.
- **A failed load shows an explanation and a retry button** instead of a blank
  white screen.

## Server requirement

Needs a Pickl server exposing `GET /api/health`, which answers anonymously with
`{"app":"pickl","version":"..."}`. The connect screen uses it to tell
"unreachable" apart from "reachable, but that is not Pickl" — a distinction
`/login` cannot make, since almost any host returns a 200 HTML page.
