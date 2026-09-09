/*
 * Pickl's service worker.
 *
 * What it is for: a phone in a kitchen or a shop, on a connection that comes
 * and goes. Without one, a dropped connection gives the browser's own error
 * page — no app, no explanation, no way back.
 *
 * What it deliberately does NOT do is cache household data. Not the plan, not
 * recipes, not the shopping list, not any /api response. Two reasons, and both
 * of them matter more than the convenience would:
 *
 *   1. A cached plan is indistinguishable from a live one. Showing Tuesday's
 *      dinner as though it were today's, because that is what was in the cache,
 *      is worse than saying "you are offline" — the reader acts on it.
 *   2. Cache Storage outlives a sign-out and belongs to the device, not the
 *      account. On a shared phone that is one household's meals sitting in
 *      another person's browser. Household privacy is the whole point of the
 *      scoping work behind this app; leaving a copy here would undo it.
 *
 * So this caches the build's own static assets — which carry no data and are
 * content-hashed — plus one offline page to land on. Everything else goes to
 * the network every time.
 */

// Bump to invalidate everything. Old caches are deleted on activate.
const CACHE = "pickl-shell-v1";
const OFFLINE_URL = "/offline";

const PRECACHE = [OFFLINE_URL, "/manifest.webmanifest", "/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Individually, not addAll: addAll rejects the whole install if any one
      // URL 404s, which would leave the app with no offline page at all
      // because an icon was renamed.
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {})
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

/** Next's build output: content-hashed, immutable, and carries no user data. */
function isBuildAsset(url) {
  return url.origin === self.location.origin && url.pathname.startsWith("/_next/static/");
}

/** The icons and manifest, which are equally static and equally impersonal. */
function isPublicAsset(url) {
  return (
    url.origin === self.location.origin &&
    /^\/(manifest\.webmanifest|icon-|apple-touch-icon)/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only ever GET. A POST or PUT that failed offline must fail loudly: a
  // queued-and-replayed plan edit would land minutes later on top of whatever
  // somebody else did in the meantime.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never touch auth or the API. See the header: a cached answer here is
  // either stale data presented as current, or a copy of one household's
  // content left on the device.
  if (url.pathname.startsWith("/api/")) return;

  if (isBuildAsset(url) || isPublicAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkThenOfflinePage(request));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  // Opaque and error responses are not worth keeping; a cached 404 for a
  // build asset would survive the deploy that fixed it.
  if (response.ok && response.type === "basic") {
    cache.put(request, response.clone());
  }
  return response;
}

async function networkThenOfflinePage(request) {
  try {
    // Always the network first: the page itself is never served from cache,
    // so nothing stale is ever shown as though it were current.
    return await fetch(request);
  } catch {
    const cache = await caches.open(CACHE);
    const offline = await cache.match(OFFLINE_URL);
    return (
      offline ??
      new Response("You are offline.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    );
  }
}
