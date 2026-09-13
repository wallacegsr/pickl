import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { householdScope } from "@/lib/permissions";
import { setFavorite } from "@/lib/favorites";

/**
 * Stars or unstars a recipe for the signed-in person.
 *
 * PUT with the desired state rather than a toggle: a double-tap on a slow
 * connection sends "true" twice and ends starred, where a toggle sent twice
 * would silently end up back where it started.
 */

const schema = z.object({ favorite: z.boolean() });

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const householdId = householdScope(session.user);
  if (!householdId) {
    return NextResponse.json({ error: "Recipe not found." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Send { favorite: true | false }." }, { status: 400 });
  }

  const result = setFavorite(session.user, householdId, params.id, parsed.data.favorite);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ favorite: result.favorite });
}
