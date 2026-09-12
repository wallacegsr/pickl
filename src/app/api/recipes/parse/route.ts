import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { parseRecipeText } from "@/lib/recipeText";

/**
 * Turns pasted text into a draft. Saves nothing.
 *
 * Deliberately not an import: the parse is a pile of heuristics, so the
 * answer goes back to the person in the recipe form for them to check and
 * correct, and it is saved — if they want it — through the ordinary
 * `POST /api/recipes`. That keeps one write path, and means a mis-read line
 * is caught by the only reviewer who knows what the recipe actually says.
 *
 * The parsing lives on the server rather than in the browser so it is one
 * testable function rather than a format the client owns, and so the same
 * endpoint can serve the Android shell or anything else later.
 */

const schema = z.object({
  text: z.string().min(1, "Paste a recipe first.").max(50_000),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // No household check and no suspension check: this reads nothing and writes
  // nothing. A suspended household can still paste a recipe to look at it —
  // saving is where it will be stopped, which is the honest place for it.

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  return NextResponse.json(parseRecipeText(parsed.data.text));
}
