import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { householdScope } from "@/lib/permissions";
import { suspensionError } from "@/lib/households";
import { bulkCopy, bulkDelete, bulkTag, type BulkSummary } from "@/lib/recipeBulk";
import { logAuditEntry } from "@/lib/audit";
import { MAX_MATCHING, matchingRecipeIds, parseRecipeQuery } from "@/lib/recipeQuery";

/**
 * Bulk recipe actions: delete; copy between the House Jar and a Secret Stash;
 * and add or remove tags.
 *
 * `preview: true` answers "what would happen?" and writes nothing. The
 * confirmation dialog calls that first, shows the answer, and then calls again
 * without it — so what a person agrees to is computed by the same code that
 * then acts. See src/lib/recipeBulk.ts.
 */

/**
 * A selection is either explicit ids, or `matching`: the Recipes page's URL
 * query ("tab=shared&tag=Quick"), meaning every recipe that query finds —
 * "Select all 312 matching". It is resolved here with the same function the
 * list uses, so it cannot reach a recipe the list would not show.
 */
const MAX_IDS = MAX_MATCHING;
const ids = z.array(z.string().min(1)).max(MAX_IDS).optional();
const matching = z.string().max(4000).optional();

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("delete"),
    ids,
    matching,
    preview: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("copy"),
    ids,
    matching,
    target: z.enum(["private", "shared"]),
    preview: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("tag"),
    ids,
    matching,
    tags: z.array(z.string().trim().min(1)).min(1, "Name at least one tag.").max(20),
    // No "replace". See bulkTag in src/lib/recipeBulk.ts for why.
    mode: z.enum(["add", "remove"]),
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
  const targetIds =
    input.matching !== undefined
      ? matchingRecipeIds(
          householdId,
          session.user.id,
          parseRecipeQuery(paramsOf(input.matching))
        )
      : (input.ids ?? []);
  if (targetIds.length === 0) {
    return NextResponse.json({ error: "Select at least one recipe." }, { status: 400 });
  }
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
    summary = bulkDelete(session.user, householdId, targetIds, preview);
    if (!preview && summary.ok > 0) {
      logAuditEntry({
        userId: session.user.id,
        action: "recipe_bulk_delete",
        notes:
          `Deleted ${summary.ok} recipe(s): ${namesOf(summary)}` +
          (summary.plannedMeals ? `, removing ${summary.plannedMeals} planned meal(s)` : ""),
      });
    }
  } else if (input.action === "tag") {
    summary = bulkTag(session.user, householdId, targetIds, input.tags, input.mode, preview);
    if (!preview && summary.ok > 0) {
      logAuditEntry({
        userId: session.user.id,
        action: "recipe_bulk_tag",
        notes:
          `${input.mode === "add" ? "Added" : "Removed"} ${input.tags.map((t) => `"${t}"`).join(", ")} ` +
          `${input.mode === "add" ? "to" : "from"} ${summary.ok} recipe(s): ${namesOf(summary)}` +
          (summary.newTags?.length ? `. New tags created: ${summary.newTags.join(", ")}` : ""),
      });
    }
  } else {
    summary = bulkCopy(session.user, householdId, targetIds, input.target, preview);
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

/** URL parameters as a record, keeping repeated keys ("tag=A&tag=B"). */
function paramsOf(query: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  new URLSearchParams(query).forEach((value, key) => {
    (out[key] ??= []).push(value);
  });
  return out;
}

/** The names a batch acted on, capped so one audit row cannot grow without bound. */
function namesOf(summary: BulkSummary): string {
  const names = summary.rows
    .filter((r) => r.status === "ok" && r.name)
    .map((r) => `"${r.name}"`);
  const shown = names.slice(0, 20).join(", ");
  return names.length > 20 ? `${shown} and ${names.length - 20} more` : shown;
}
