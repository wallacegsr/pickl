/**
 * The running app's version, from package.json via next.config.js.
 *
 * One source of truth, deliberately. package.json's version, the heading in
 * CHANGELOG.md and the Android shell's `versionName` all have to agree about
 * what is running; a version reported from a second hardcoded constant would
 * drift from the changelog the first time someone bumped one and not the other.
 *
 * `NEXT_PUBLIC_APP_VERSION` is inlined at build time, so this works in client
 * and server components alike. The fallback covers a bundler that did not run
 * through next.config.js (a test runner, say) rather than any real deployment.
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
