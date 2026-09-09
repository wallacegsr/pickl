import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/permissions";
import { createHousehold, listHouseholds } from "@/lib/households";
import { logAuditEntry } from "@/lib/audit";

/**
 * The platform operator's households endpoint.
 *
 * Gated on `isPlatformAdmin` — NOT on `isAdmin`, which is now a household
 * role and says nothing about the deployment. Everything it returns is
 * household metadata: names, sizes, dates. There is deliberately no endpoint
 * anywhere that hands an operator a household's contents.
 */

const createSchema = z.object({
  name: z.string().min(1, "Enter a household name.").max(80),
});

export async function GET() {
  const session = await auth();
  if (!session?.user || !isPlatformAdmin(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(listHouseholds());
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !isPlatformAdmin(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const result = createHousehold(parsed.data.name);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  logAuditEntry({
    userId: session.user.id,
    action: "household_create",
    notes: `Created household "${result.household.name}"`,
  });

  return NextResponse.json(result.household, { status: 201 });
}
