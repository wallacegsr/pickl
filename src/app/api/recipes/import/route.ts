import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { householdScope } from "@/lib/permissions";
import { suspensionError } from "@/lib/households";
import { importRecipes, readRecipeArray } from "@/lib/recipeImport";
import { logAuditEntry } from "@/lib/audit";

/**
 * Bulk recipe import.
 *
 * Takes an array of exactly what `POST /api/recipes` accepts — the shape the
 * recipe scraper already writes, and the shape `GET /api/recipes/export`
 * gives back, so a file that came out of Pickl goes straight back in.
 *
 * Any signed-in member may import. Importing into the shared pool needs the
 * same permission as creating a shared recipe by hand, which the importer
 * checks per row.
 */

const optionsSchema = z.object({
  visibility: z.enum(["shared", "private"]).optional(),
  allowDuplicates: z.boolean().optional(),
});

/** How many recipes one request may carry. */
const MAX_ITEMS = 500;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const body = await req.json().catch(() => null);
  if (body === null) {
    return NextResponse.json(
      { error: "That is not valid JSON. Check the file opens in a text editor." },
      { status: 400 }
    );
  }

  const list = readRecipeArray(body);
  if (!list.ok) {
    return NextResponse.json({ error: list.error }, { status: 400 });
  }

  if (list.items.length === 0) {
    return NextResponse.json({ error: "That file has no recipes in it." }, { status: 400 });
  }

  if (list.items.length > MAX_ITEMS) {
    return NextResponse.json(
      {
        error: `That file has ${list.items.length} recipes; ${MAX_ITEMS} is the most one import can take. Split it and run it twice.`,
      },
      { status: 413 }
    );
  }

  // Options travel alongside the array when the body is an object. A bare
  // array carries none, which is the scraper's case.
  const parsedOptions = optionsSchema.safeParse(
    Array.isArray(body) ? {} : ((body as { options?: unknown }).options ?? {})
  );
  if (!parsedOptions.success) {
    return NextResponse.json(
      { error: parsedOptions.error.issues[0]?.message ?? "Invalid options" },
      { status: 400 }
    );
  }

  const summary = importRecipes(
    session.user,
    householdId,
    list.items,
    parsedOptions.data
  );

  // One row for the batch, not one per recipe — see the recipe_import note in
  // src/lib/audit.ts.
  if (summary.imported > 0 || summary.failed > 0) {
    logAuditEntry({
      userId: session.user.id,
      action: "recipe_import",
      notes:
        `Imported ${summary.imported} recipe(s)` +
        (summary.skipped ? `, skipped ${summary.skipped} already in the jar` : "") +
        (summary.failed ? `, ${summary.failed} could not be read` : ""),
    });
  }

  return NextResponse.json(summary, { status: summary.imported > 0 ? 201 : 200 });
}
