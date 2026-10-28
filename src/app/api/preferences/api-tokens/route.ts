import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { API_TOKEN_SCOPES } from "@/db/schema";
import { auth } from "@/lib/auth";
import { createApiToken, householdAllowsApi, listApiTokens } from "@/lib/apiTokens";
import { logAuditEntry } from "@/lib/audit";
import { suspensionError } from "@/lib/households";
import { householdScope } from "@/lib/permissions";

/**
 * The caller's own API tokens. Self-service like every /api/preferences
 * route: the user is the session's, with no id to substitute, and there is no
 * admin view of anyone else's tokens.
 */

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const householdId = householdScope(session.user);
  return NextResponse.json({
    apiAccess: householdId ? householdAllowsApi(householdId) : false,
    tokens: listApiTokens(session.user.id),
  });
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Give the token a name, such as \"Home Assistant\".").max(60),
  scope: z.enum(API_TOKEN_SCOPES),
  // null: never expires.
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365), z.null()]).default(null),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const householdId = householdScope(session.user);
  if (!householdId) {
    return NextResponse.json({ error: "This account is not part of a household." }, { status: 403 });
  }
  const suspended = suspensionError(householdId);
  if (suspended) return NextResponse.json({ error: suspended.error }, { status: suspended.status });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const result = createApiToken({ userId: session.user.id, householdId, ...parsed.data });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  logAuditEntry({
    userId: session.user.id,
    action: "api_token_create",
    targetUserId: session.user.id,
    notes: `Created API token "${result.summary.name}" (${result.summary.scope})`,
  });

  // The only time the token is ever sent: it is not stored, so it cannot be shown again.
  return NextResponse.json({ token: result.token, summary: result.summary }, { status: 201 });
}
