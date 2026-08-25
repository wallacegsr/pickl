import type { CalendarAccount, CalendarTarget } from "@/db/schema";
import { getCaldavCredentials } from "./accounts";
import { CaldavCalendarProvider } from "./caldav";
import { GoogleCalendarProvider } from "./google";
import { getAccessTokenForAccount } from "./googleOAuth";
import type { CalendarProvider } from "./types";

export * from "./types";

/**
 * Builds the provider for one sync target. Throws (with a message the user
 * can act on) rather than returning null, so every caller is forced to
 * deal with misconfiguration explicitly.
 *
 * Credentials never appear here: the provider receives a *function* that
 * mints a short-lived access token on first use, so the refresh token is
 * decrypted at most once per push and only inside ./googleOAuth.
 */
export type ProviderFactory = (
  target: CalendarTarget,
  account: CalendarAccount
) => CalendarProvider;

const defaultProviderFactory: ProviderFactory = (target, account) => {
  switch (account.provider) {
    case "google":
      return new GoogleCalendarProvider(
        () => getAccessTokenForAccount(account),
        target.calendarId
      );
    case "caldav":
      // The password is decrypted here, once per push, and lives only in
      // the provider instance — same shape as the Google branch above,
      // where the refresh token never leaves ./googleOAuth. `calendarId`
      // holds the collection URL for this provider.
      return new CaldavCalendarProvider(
        getCaldavCredentials(account),
        target.calendarId,
        target.id
      );
    default:
      throw new Error(`Unknown calendar provider "${account.provider}".`);
  }
};

let providerFactory: ProviderFactory = defaultProviderFactory;

export function getProviderForTarget(
  target: CalendarTarget,
  account: CalendarAccount
): CalendarProvider {
  return providerFactory(target, account);
}

/**
 * Test seam. Swaps in a fake provider so the fan-out and non-fatal-failure
 * behaviour can be exercised end-to-end without a Google account. Returns
 * a function that restores the real factory.
 *
 * Not reachable from any route — nothing in src/app calls it.
 */
export function __setProviderFactoryForTests(
  factory: ProviderFactory
): () => void {
  const previous = providerFactory;
  providerFactory = factory;
  return () => {
    providerFactory = previous;
  };
}
