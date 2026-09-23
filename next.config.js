// The app's version comes from package.json, which is the single source the
// changelog and the Android shell's versionName are kept in step with. Passing
// it through `env` inlines the string at build time, so the client gets the
// version without package.json (and its whole dependency list) being pulled
// into the browser bundle.
const { version } = require("./package.json");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
  // Baseline hardening headers on every response. A strict script CSP is not
  // here yet: the no-flash theme scripts are inline, so it would need nonces.
  // What is here costs nothing and closes the cheap attacks — Pickl in a
  // hostile iframe (clickjacking a Delete), MIME sniffing an export, and full
  // URLs (with week and user ids) leaking in the Referer to recipe sources.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
  // Don't advertise the framework and version to anyone scanning for it.
  poweredByHeader: false,
  // Pickl never uses next/image, but Next serves its optimiser at
  // /_next/image regardless — and that endpoint carries critical advisories
  // on 14.x (remote code execution via crafted AVIF). Turning it off removes
  // the endpoint entirely.
  images: { unoptimized: true },
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
  },
};

module.exports = nextConfig;
