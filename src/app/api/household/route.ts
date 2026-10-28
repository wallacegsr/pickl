import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { householdScope, isHouseholdAdmin } from "@/lib/permissions";
import {
  getHousehold,
  renameHousehold,
  suspensionError,
  updateHouseholdSettings,
} from "@/lib/households";
import { logAuditEntry } from "@/lib/audit";
import { isValidTimeZone, serverTimeZone } from "@/lib/householdTime";
import type { Household } from "@/db/schema";

/**
 * A household admin's own household settings.
 *
 * Deliberately takes no id: the household is the caller's own, read from the
 * session, so there is no id for anyone to substitute. That is the whole
 * reason this exists separately from /api/admin/households/[id] rather than
 * sharing it with an "or if it's yours" branch.
 */

const patchSchema = z
  .object({
    name: z.string().min(1, "Enter a household name.").max(80).optional(),
    // null clears it, so the server's own zone is used again.
    timeZone: z
      .string()
      .refine(isValidTimeZone, "That isn't a time zone this server recognises.")
      .nullable()
      .optional(),
    apiAccess: z.boolean().optional(),
  })
  .refine((v) => v.name !== undefined || v.timeZone !== undefined || v.apiAccess !== undefined, {
    message: "Nothing to change.",
  });

function view(household: Household) {
  return {
    id: household.id,
    name: household.name,
    suspended: household.suspended,
    timeZone: household.timeZone,
    serverTimeZone: serverTimeZone(),
    apiAccess: household.apiAccess,
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const householdId = householdScope(session.user);
  if (!householdId) return NextResponse.json(null);

  const household = getHousehold(householdId);
  if (!household) return NextResponse.json(null);

  return NextResponse.json(view(household));
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

  // A change is a household write like any other, and the banner the panel
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
  const { name, timeZone, apiAccess } = parsed.data;

  const before = getHousehold(householdId);
  if (!before) return NextResponse.json({ error: "Household not found." }, { status: 404 });

  if (name !== undefined && name !== before.name) {
    const result = renameHousehold(householdId, name);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    logAuditEntry({
      userId: session.user.id,
      action: "household_rename",
      notes: `Renamed household "${before.name}" to "${result.household.name}"`,
    });
  }

  const changes: string[] = [];
  if (timeZone !== undefined && timeZone !== before.timeZone) {
    changes.push(`time zone ${before.timeZone ?? "(server's)"} → ${timeZone ?? "(server's)"}`);
  }
  if (apiAccess !== undefined && apiAccess !== before.apiAccess) {
    changes.push(apiAccess ? "turned API access on" : "turned API access off");
  }
  if (changes.length > 0) {
    updateHouseholdSettings(householdId, {
      ...(timeZone !== undefined ? { timeZone } : {}),
      ...(apiAccess !== undefined ? { apiAccess } : {}),
    });
    logAuditEntry({
      userId: session.user.id,
      action: "household_settings",
      notes: `Household settings: ${changes.join("; ")}`,
    });
  }

  return NextResponse.json(view(getHousehold(householdId)!));
}
