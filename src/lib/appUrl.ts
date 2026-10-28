/**
 * The app's public base URL, matching the convention in src/lib/mail.ts.
 *
 * Its own module so code that only needs a link — the API's recipe URLs —
 * does not import the Google OAuth client to get one.
 */
export function getAppBaseUrl(): string {
  return (
    process.env.APP_BASE_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000"
  ).replace(/\/+$/, "");
}
