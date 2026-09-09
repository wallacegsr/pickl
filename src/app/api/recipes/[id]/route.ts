import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { recipes } from "@/db/schema";
import { recipeSchema } from "@/lib/validators";
import { canEditRecipe, canEditSharedRecipes, householdScope } from "@/lib/permissions";
import { attachTagsToRecipe, parseTagInput, setRecipeTags } from "@/lib/tags";
import { logAuditEntry } from "@/lib/audit";
import { suspensionError } from "@/lib/households";

interface Params {
  params: { id: string };
}

/**
 * One recipe, looked up by id AND household.
 *
 * The household belongs in the WHERE clause rather than in a check after
 * the fact: another family's *shared* recipe would satisfy the visibility
 * rule below perfectly well, and the only thing wrong with it is that it
 * isn't ours. Unresolvable is the right answer, and it gives the existing
 * 404 for free.
 */
function findRecipe(householdId: string, id: string) {
  return db
    .select()
    .from(recipes)
    .where(and(eq(recipes.id, id), eq(recipes.householdId, householdId)))
    .get();
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const householdId = householdScope(session.user);
  if (!householdId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const recipe = findRecipe(householdId, params.id);

  if (!recipe) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (recipe.visibility === "private" && recipe.ownerUserId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(attachTagsToRecipe(householdId, recipe));
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const householdId = householdScope(session.user);
  if (!householdId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const existing = findRecipe(householdId, params.id);

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!canEditRecipe(session.user, existing)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const suspended = suspensionError(householdId);
  if (suspended) {
    return NextResponse.json({ error: suspended.error }, { status: suspended.status });
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

  // Changing visibility to "shared" requires admin; a member editing their
  // own private recipe cannot promote it to shared.
  if (data.visibility === "shared" && !canEditSharedRecipes(session.user)) {
    return NextResponse.json(
      { error: "Only admins can make a recipe shared." },
      { status: 403 }
    );
  }

  db.update(recipes)
    .set({
      name: data.name,
      ingredients: data.ingredients,
      instructions: data.instructions,
      prepTimeMinutes: data.prepTimeMinutes ?? null,
      cookTimeMinutes: data.cookTimeMinutes ?? null,
      servings: data.servings ?? null,
      sourceUrl: data.sourceUrl || null,
      notes: data.notes || null,
      visibility: data.visibility,
      ownerUserId: data.visibility === "private" ? existing.ownerUserId ?? session.user.id : null,
      mealType: data.mealType.join(","),
    })
    .where(eq(recipes.id, params.id))
    .run();

  setRecipeTags(householdId, params.id, parseTagInput(data.tags ?? ""), session.user.id);

  logAuditEntry({
    userId: session.user.id,
    action: "recipe_update",
    notes: `Updated recipe "${data.name}"`,
  });

  const updated = findRecipe(householdId, params.id);

  return NextResponse.json(updated ? attachTagsToRecipe(householdId, updated) : null);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const householdId = householdScope(session.user);
  if (!householdId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const existing = findRecipe(householdId, params.id);

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!canEditRecipe(session.user, existing)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const suspended = suspensionError(householdId);
  if (suspended) {
    return NextResponse.json({ error: suspended.error }, { status: suspended.status });
  }


  db.delete(recipes).where(eq(recipes.id, params.id)).run();

  logAuditEntry({
    userId: session.user.id,
    action: "recipe_delete",
    notes: `Deleted recipe "${existing.name}"`,
  });

  return NextResponse.json({ message: "Deleted" });
}
