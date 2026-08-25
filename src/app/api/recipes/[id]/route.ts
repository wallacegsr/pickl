import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { recipes } from "@/db/schema";
import { recipeSchema } from "@/lib/validators";
import { canEditRecipe, canEditSharedRecipes } from "@/lib/permissions";
import { logAuditEntry } from "@/lib/audit";

interface Params {
  params: { id: string };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const recipe = db
    .select()
    .from(recipes)
    .where(eq(recipes.id, params.id))
    .get();

  if (!recipe) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (recipe.visibility === "private" && recipe.ownerUserId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(recipe);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = db
    .select()
    .from(recipes)
    .where(eq(recipes.id, params.id))
    .get();

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!canEditRecipe(session.user, existing)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
      tags: data.tags ?? "",
      sourceUrl: data.sourceUrl || null,
      notes: data.notes || null,
      visibility: data.visibility,
      ownerUserId: data.visibility === "private" ? existing.ownerUserId ?? session.user.id : null,
      mealType: data.mealType.join(","),
    })
    .where(eq(recipes.id, params.id))
    .run();

  logAuditEntry({
    userId: session.user.id,
    action: "recipe_update",
    notes: `Updated recipe "${data.name}"`,
  });

  const updated = db
    .select()
    .from(recipes)
    .where(eq(recipes.id, params.id))
    .get();

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = db
    .select()
    .from(recipes)
    .where(eq(recipes.id, params.id))
    .get();

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!canEditRecipe(session.user, existing)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  db.delete(recipes).where(eq(recipes.id, params.id)).run();

  logAuditEntry({
    userId: session.user.id,
    action: "recipe_delete",
    notes: `Deleted recipe "${existing.name}"`,
  });

  return NextResponse.json({ message: "Deleted" });
}
