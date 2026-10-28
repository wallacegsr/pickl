import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolvePlanContext, type PlanContext } from "@/lib/planContext";
import { suspensionError } from "@/lib/households";
import { deleteExtra, setExtraOnHand } from "@/lib/shoppingExtras";
import { scopeSchema } from "@/lib/validators";

type Params = { params: Promise<{ id: string }> };

/**
 * The calendar the item must belong to, from `?scope=&userId=`. The id alone
 * reaches nothing: an item on a list this person cannot see is "not found".
 */
async function context(req: NextRequest): Promise<PlanContext | NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = scopeSchema.catch("shared").parse(req.nextUrl.searchParams.get("scope") ?? "shared");
  const resolved = resolvePlanContext(
    session.user,
    scope,
    req.nextUrl.searchParams.get("userId"),
    "read"
  );
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const suspended = suspensionError(resolved.context.householdId);
  if (suspended) return NextResponse.json({ error: suspended.error }, { status: suspended.status });
  return resolved.context;
}

const patchSchema = z.object({ onHand: z.boolean() });

export async function PATCH(req: NextRequest, props: Params) {
  const ctx = await context(req);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const item = setExtraOnHand(ctx, (await props.params).id, parsed.data.onHand);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(item);
}

export async function DELETE(req: NextRequest, props: Params) {
  const ctx = await context(req);
  if (ctx instanceof NextResponse) return ctx;
  if (!deleteExtra(ctx, (await props.params).id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
