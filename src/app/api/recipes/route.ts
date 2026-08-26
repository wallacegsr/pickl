import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { desc, eq, or } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { recipes } from "@/db/schema";
import { recipeSchema } from "@/lib/validators";
import { canEditSharedRecipes } from "@/lib/permissions";
import { attachTags, attachTagsToRecipe, parseTagInput, setRecipeTags } from "@/lib/tags";
import { logAuditEntry } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Every user sees the shared pool plus their own private recipes.
  const allRecipes = db
    .select()
    .from(recipes)
    .where(
      or(eq(recipes.visibility, "shared"), eq(recipes.ownerUserId, session.user.id))
    )
    .orderBy(desc(recipes.createdAt))
    .all();

  // One extra query for the whole page of recipes, never one per recipe.
  return NextResponse.json(attachTags(allRecipes));
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

  setRecipeTags(id, parseTagInput(data.tags ?? ""), session.user.id);

  logAuditEntry({
    userId: session.user.id,
    action: "recipe_create",
    notes: `Created recipe "${data.name}" (${data.visibility})`,
  });

  const created = db.select().from(recipes).where(eq(recipes.id, id)).get();

  return NextResponse.json(created ? attachTagsToRecipe(created) : null, {
    status: 201,
  });
}
