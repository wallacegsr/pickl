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
  // /_next/image regardless. Several of Next's advisories have been in that
  // endpoint; with nothing to optimise, it is simply switched off.
  images: { unoptimized: true },
  // Bootstrap 5's Sass still uses @import and the global colour functions,
  // which newer Sass (bundled with Next 15) warns about on every build — dozens
  // of lines that would bury a real warning. Silenced until Bootstrap moves to
  // the module system; they are deprecations, not errors.
  sassOptions: {
    quietDeps: true,
    silenceDeprecations: ["import", "global-builtin", "color-functions", "legacy-js-api", "mixed-decls"],
  },
  // Stable in Next 15 (was experimental.serverComponentsExternalPackages).
  // better-sqlite3 is a native addon and must be required at runtime, not
  // bundled.
  serverExternalPackages: ["better-sqlite3"],
};

module.exports = nextConfig;
