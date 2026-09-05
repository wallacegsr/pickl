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
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
  },
};

module.exports = nextConfig;
