import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, or } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { recipes } from "@/db/schema";
import { recipeSchema } from "@/lib/validators";
import { canEditSharedRecipes, householdScope } from "@/lib/permissions";
import { attachTags } from "@/lib/tags";
import { createRecipe } from "@/lib/recipes";
import { logAuditEntry } from "@/lib/audit";
import { suspensionError } from "@/lib/households";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const householdId = householdScope(session.user);
  if (!householdId) return NextResponse.json([]);

  // Every user sees their household's shared pool plus their own private
  // recipes.
  const allRecipes = db
    .select()
    .from(recipes)
    .where(
      and(
        eq(recipes.householdId, householdId),
        or(eq(recipes.visibility, "shared"), eq(recipes.ownerUserId, session.user.id))
      )
    )
    .orderBy(desc(recipes.createdAt))
    .all();

  // One extra query for the whole page of recipes, never one per recipe.
  return NextResponse.json(attachTags(householdId, allRecipes));
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = recipeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const data = parsed.data;

  const householdId = householdScope(session.user);
  if (!householdId) {
    return NextResponse.json(
      { error: "This account is not part of a household." },
      { status: 403 }
    );
  }

  const suspended = suspensionError(householdId);
  if (suspended) {
    return NextResponse.json({ error: suspended.error }, { status: suspended.status });
  }

  if (data.visibility === "shared" && !canEditSharedRecipes(session.user)) {
    return NextResponse.json(
      { error: "Only admins can create shared recipes." },
      { status: 403 }
    );
  }

  // The shared write path, so this and the importer cannot drift apart about
  // what creating a recipe means. See src/lib/recipes.ts.
  const created = createRecipe({
    householdId,
    actingUserId: session.user.id,
    data,
  });

  logAuditEntry({
    userId: session.user.id,
    action: "recipe_create",
    notes: `Created recipe "${data.name}" (${data.visibility})`,
  });

  return NextResponse.json(created, { status: 201 });
}
