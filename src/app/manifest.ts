import type { MetadataRoute } from "next";

/**
 * The web app manifest, which is what lets Pickl be installed to a phone's
 * home screen and run without browser chrome.
 *
 * On Android this is a nicety next to the APK. On iOS it is the only route
 * there is — Apple ships no way to sideload — so "Add to Home Screen" plus
 * this file is how an iPhone household gets Pickl at all.
 *
 * `start_url` is /plan rather than /, because / only ever redirects to it and
 * an installed app that begins with a redirect flashes an empty frame first.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pickl",
    short_name: "Pickl",
    description: "Out of the pickle, onto the plate.",
    start_url: "/plan",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // The pale green paper of the default palette. The manifest can only
    // carry one, and this is the surface a cold start paints before any
    // stylesheet or stored preference has been read.
    background_color: "#f6f8ef",
    theme_color: "#3a7d44",
    categories: ["food", "lifestyle", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Drawn smaller inside the same tile: a launcher crops a maskable icon
      // to whatever shape it likes, and artwork sized for a square loses its
      // edges to a circle.
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "This week's plan",
        short_name: "Plan",
        url: "/plan",
      },
      {
        name: "Shopping list",
        short_name: "Shopping",
        url: "/shopping",
      },
    ],
  };
}
