import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { householdScope, isHouseholdAdmin } from "@/lib/permissions";
import { getHousehold, renameHousehold, suspensionError } from "@/lib/households";
import { logAuditEntry } from "@/lib/audit";

/**
 * A household admin's own household settings.
 *
 * Deliberately takes no id: the household is the caller's own, read from the
 * session, so there is no id for anyone to substitute. That is the whole
 * reason this exists separately from /api/admin/households/[id] rather than
 * sharing it with an "or if it's yours" branch.
 */

const patchSchema = z.object({
  name: z.string().min(1, "Enter a household name.").max(80),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const householdId = householdScope(session.user);
  if (!householdId) return NextResponse.json(null);

  const household = getHousehold(householdId);
  if (!household) return NextResponse.json(null);

  return NextResponse.json({
    id: household.id,
    name: household.name,
    suspended: household.suspended,
  });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !isHouseholdAdmin(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const householdId = householdScope(session.user);
  if (!householdId) {
    return NextResponse.json(
      { error: "This account is not part of a household." },
      { status: 403 }
    );
  }

  // A rename is a household write like any other, and the banner the panel
  // shows while suspended promises nothing can be changed.
  const suspended = suspensionError(householdId);
  if (suspended) {
    return NextResponse.json({ error: suspended.error }, { status: suspended.status });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const before = getHousehold(householdId);
  const result = renameHousehold(householdId, parsed.data.name);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  logAuditEntry({
    userId: session.user.id,
    action: "household_rename",
    notes: `Renamed household "${before?.name ?? "?"}" to "${result.household.name}"`,
  });

  return NextResponse.json({
    id: result.household.id,
    name: result.household.name,
    suspended: result.household.suspended,
  });
}
