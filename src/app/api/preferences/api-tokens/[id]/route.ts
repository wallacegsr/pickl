import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { revokeApiToken } from "@/lib/apiTokens";
import { logAuditEntry } from "@/lib/audit";

/** Revokes one of the caller's own tokens. Another person's token id matches nothing. */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await props.params;

  const revoked = revokeApiToken(session.user.id, id);
  if (!revoked) return NextResponse.json({ error: "Not found" }, { status: 404 });

  logAuditEntry({
    userId: session.user.id,
    action: "api_token_revoke",
    targetUserId: session.user.id,
    notes: `Revoked API token "${revoked.name}" (${revoked.scope})`,
  });
  return NextResponse.json({ revoked: true });
}
