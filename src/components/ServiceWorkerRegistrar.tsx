"use client";

import { useEffect } from "react";

/**
 * Registers the service worker in public/sw.js.
 *
 * Renders nothing. Registration happens after mount rather than during render
 * because it is a browser-only side effect, and it is skipped in development:
 * a worker that serves the previous build's assets from cache is a confusing
 * thing to debug, and turning it off is not something a dev-server reload does
 * by itself.
 *
 * Failure is silent by design. A service worker is an enhancement — an offline
 * page and slightly faster static assets — so a browser that refuses to
 * register one (a private window, an insecure origin, a policy) should get the
 * app working normally rather than an error about a feature it cannot have.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Nothing to do and nothing worth saying: see above.
      });
    };

    // After load, so registering never competes with the first paint for
    // bandwidth on the slow connection this is meant to help with.
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
