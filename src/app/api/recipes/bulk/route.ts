import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { householdScope } from "@/lib/permissions";
import { suspensionError } from "@/lib/households";
import { bulkCopy, bulkDelete, type BulkSummary } from "@/lib/recipeBulk";
import { logAuditEntry } from "@/lib/audit";

/**
 * Bulk recipe actions: delete, and copy between the House Jar and a Secret
 * Stash.
 *
 * `preview: true` answers "what would happen?" and writes nothing. The
 * confirmation dialog calls that first, shows the answer, and then calls again
 * without it — so what a person agrees to is computed by the same code that
 * then acts. See src/lib/recipeBulk.ts.
 */

const MAX_IDS = 500;

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("delete"),
    ids: z.array(z.string().min(1)).min(1, "Select at least one recipe.").max(MAX_IDS),
    preview: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("copy"),
    ids: z.array(z.string().min(1)).min(1, "Select at least one recipe.").max(MAX_IDS),
    target: z.enum(["private", "shared"]),
    preview: z.boolean().optional(),
  }),
]);

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

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }
  const input = parsed.data;
  const preview = input.preview === true;

  // A preview writes nothing, so a suspended household may still ask what a
  // delete WOULD do. Acting on it is where it is stopped.
  if (!preview) {
    const suspended = suspensionError(householdId);
    if (suspended) {
      return NextResponse.json({ error: suspended.error }, { status: suspended.status });
    }
  }

  let summary: BulkSummary;
  if (input.action === "delete") {
    summary = bulkDelete(session.user, householdId, input.ids, preview);
    if (!preview && summary.ok > 0) {
      logAuditEntry({
        userId: session.user.id,
        action: "recipe_bulk_delete",
        notes:
          `Deleted ${summary.ok} recipe(s): ${namesOf(summary)}` +
          (summary.plannedMeals ? `, removing ${summary.plannedMeals} planned meal(s)` : ""),
      });
    }
  } else {
    summary = bulkCopy(session.user, householdId, input.ids, input.target, preview);
    if (!preview && summary.ok > 0) {
      logAuditEntry({
        userId: session.user.id,
        action: "recipe_copy",
        notes:
          `Copied ${summary.ok} recipe(s) to ` +
          `${input.target === "private" ? "their Secret Stash" : "the House Jar"}: ${namesOf(summary)}`,
      });
    }
  }

  return NextResponse.json(summary);
}

/** The names a batch acted on, capped so one audit row cannot grow without bound. */
function namesOf(summary: BulkSummary): string {
  const names = summary.rows
    .filter((r) => r.status === "ok" && r.name)
    .map((r) => `"${r.name}"`);
  const shown = names.slice(0, 20).join(", ");
  return names.length > 20 ? `${shown} and ${names.length - 20} more` : shown;
}
