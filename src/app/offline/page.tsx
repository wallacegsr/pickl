import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline · Pickl" };

/**
 * Where a navigation lands when the network is gone.
 *
 * Deliberately outside the (app) route group, so it needs no session and no
 * database — a page that queried either would be exactly as unreachable as the
 * one the reader was trying to open.
 *
 * It shows nothing about the household on purpose. The service worker caches
 * no plan, no recipes and no shopping list (see public/sw.js), so there is
 * nothing truthful to show here; a remembered meal presented on an offline
 * screen would be read as today's.
 */
export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: "26rem" }}>
        <p style={{ fontSize: "3rem", margin: 0 }}>🥒</p>
        <h1 style={{ fontSize: "1.5rem", marginTop: "0.5rem" }}>No connection</h1>
        <p style={{ color: "#5c6b57" }}>
          Pickl keeps your plan on your own server, so it needs to reach it to
          show you anything. This page will work again as soon as you are back
          on a network.
        </p>
        <p style={{ color: "#5c6b57", fontSize: "0.875rem" }}>
          Nothing has been lost — the plan is on the server, not in this
          browser.
        </p>
        <a
          href="/plan"
          style={{
            display: "inline-block",
            marginTop: "0.5rem",
            padding: "0.5rem 1.25rem",
            borderRadius: "0.5rem",
            background: "#3a7d44",
            color: "#fff",
            textDecoration: "none",
          }}
        >
          Try again
        </a>
      </div>
    </main>
  );
}
