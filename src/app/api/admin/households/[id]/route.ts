import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/permissions";
import {
  deleteHousehold,
  getHousehold,
  renameHousehold,
  setHouseholdSuspended,
} from "@/lib/households";
import { logAuditEntry } from "@/lib/audit";

interface Params {
  params: { id: string };
}

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  suspended: z.boolean().optional(),
});

const deleteSchema = z.object({
  /** The household's exact name, typed back by the operator. */
  confirmName: z.string(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user || !isPlatformAdmin(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const before = getHousehold(params.id);
  if (!before) {
    return NextResponse.json({ error: "Household not found." }, { status: 404 });
  }

  if (parsed.data.name !== undefined) {
    const result = renameHousehold(params.id, parsed.data.name);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    logAuditEntry({
      userId: session.user.id,
      action: "household_rename",
      notes: `Renamed household "${before.name}" to "${result.household.name}"`,
    });
  }

  if (parsed.data.suspended !== undefined) {
    const result = setHouseholdSuspended(params.id, parsed.data.suspended);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    logAuditEntry({
      userId: session.user.id,
      action: "household_suspend",
      notes: `${parsed.data.suspended ? "Suspended" : "Resumed"} household "${result.household.name}"`,
    });
  }

  return NextResponse.json(getHousehold(params.id));
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user || !isPlatformAdmin(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Type the household's name to confirm." },
      { status: 400 }
    );
  }

  const result = deleteHousehold(params.id, parsed.data.confirmName);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Logged after the fact, and by name rather than by id: the household row
  // is gone, so an id here would point at nothing anyone could look up.
  logAuditEntry({
    userId: session.user.id,
    action: "household_delete",
    notes: `Deleted household "${result.household.name}" and everything in it`,
  });

  return NextResponse.json({ message: "Deleted" });
}
