import { NextRequest } from "next/server";
import { apiJson, withApi } from "@/lib/api/v1";
import { getHousehold } from "@/lib/households";
import { householdTimeZone, householdToday } from "@/lib/householdTime";
import { APP_VERSION } from "@/lib/version";

/**
 * Who this token is, and that Pickl is reachable. For a connectivity sensor,
 * and for checking a token works before building anything on it.
 */
export function GET(req: NextRequest) {
  return withApi(req, "read", (principal) => {
    const household = getHousehold(principal.householdId);
    return apiJson({
      app: "pickl",
      version: APP_VERSION,
      household: household?.name ?? null,
      user: principal.user.name,
      token: { name: principal.token.name, scope: principal.token.scope },
      time_zone: householdTimeZone(principal.householdId),
      today: householdToday(principal.householdId),
    });
  });
}
