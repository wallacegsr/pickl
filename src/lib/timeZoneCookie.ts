/**
 * The cookie that tells the server which time zone the person is in.
 *
 * Kept in its own file with no server imports, so the browser component that
 * writes it and the server code that reads it share one name.
 */
export const TIME_ZONE_COOKIE = "pickl-tz";
