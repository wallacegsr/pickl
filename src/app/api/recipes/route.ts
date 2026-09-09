import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { and, desc, eq, or } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { recipes } from "@/db/schema";
import { recipeSchema } from "@/lib/validators";
import { canEditSharedRecipes, householdScope } from "@/lib/permissions";
import { attachTags, attachTagsToRecipe, parseTagInput, setRecipeTags } from "@/lib/tags";
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

  const id = randomUUID();

  db.insert(recipes)
    .values({
      id,
      householdId,
      name: data.name,
      ingredients: data.ingredients,
      instructions: data.instructions,
      prepTimeMinutes: data.prepTimeMinutes ?? null,
      cookTimeMinutes: data.cookTimeMinutes ?? null,
      servings: data.servings ?? null,
      sourceUrl: data.sourceUrl || null,
      notes: data.notes || null,
      visibility: data.visibility,
      ownerUserId: data.visibility === "private" ? session.user.id : null,
      mealType: data.mealType.join(","),
      createdByUserId: session.user.id,
    })
    .run();

  setRecipeTags(householdId, id, parseTagInput(data.tags ?? ""), session.user.id);

  logAuditEntry({
    userId: session.user.id,
    action: "recipe_create",
    notes: `Created recipe "${data.name}" (${data.visibility})`,
  });

  const created = db.select().from(recipes).where(eq(recipes.id, id)).get();

  return NextResponse.json(created ? attachTagsToRecipe(householdId, created) : null, {
    status: 201,
  });
}
