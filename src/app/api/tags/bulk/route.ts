import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { householdScope } from "@/lib/permissions";
import {
  canSeeTag,
  deleteTag,
  getTagById,
  getTagUsage,
  tagStaysVisibleAfterDelete,
  type TagBulkRow,
  type TagBulkSummary,
} from "@/lib/tags";
import { logAuditEntry } from "@/lib/audit";

/**
 * Bulk tag deletion.
 *
 * Each tag goes through `deleteTag`, the same function behind the single
 * Delete button — not a batch-shaped rewrite of it. That function carries the
 * rule that matters: a tag edit only ever touches recipes the person could
 * already edit, and a tag left on recipes out of their reach survives on
 * those. Restating that rule here for the batch case would be a second copy
 * of it, free to drift.
 *
 * `preview: true` reports what would happen and writes nothing, for the
 * confirmation dialog.
 */

const schema = z.object({
  ids: z.array(z.string().min(1)).min(1, "Select at least one tag.").max(500),
  preview: z.boolean().optional(),
});

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
  const preview = parsed.data.preview === true;
  const user = session.user;

  const rows: TagBulkRow[] = [];

  for (const id of [...new Set(parsed.data.ids)]) {
    const tag = getTagById(householdId, id);
    if (!tag || !canSeeTag(user, id)) {
      rows.push({ id, name: null, status: "failed", reason: "Tag not found." });
      continue;
    }

    const usage = getTagUsage(user, id);
    if (usage.total > 0 && usage.editable === 0) {
      rows.push({
        id,
        name: tag.name,
        status: "skipped",
        reason: "Every recipe using it is one you can't edit.",
        removedFrom: 0,
        keptOn: usage.locked,
      });
      continue;
    }

    if (preview) {
      rows.push({
        id,
        name: tag.name,
        status: "ok",
        removedFrom: usage.editable,
        keptOn: usage.locked,
        staysVisible: usage.locked > 0 && tagStaysVisibleAfterDelete(user, id),
      });
      continue;
    }

    const result = deleteTag(user, id);
    if (!result.ok) {
      // Suspension lands here too: deleteTag checks it, so this route does not
      // have to remember to.
      rows.push({ id, name: tag.name, status: "failed", reason: result.error });
      continue;
    }
    rows.push({
      id,
      name: tag.name,
      status: "ok",
      removedFrom: result.movedRecipes,
      keptOn: result.lockedRecipes,
    });
  }

  const summary: TagBulkSummary = {
    dryRun: preview,
    ok: rows.filter((r) => r.status === "ok").length,
    skipped: rows.filter((r) => r.status === "skipped").length,
    failed: rows.filter((r) => r.status === "failed").length,
    removedFrom: rows.reduce((n, r) => n + (r.removedFrom ?? 0), 0),
    rows,
  };

  if (!preview && summary.ok > 0) {
    const names = rows.filter((r) => r.status === "ok").map((r) => `"${r.name}"`);
    logAuditEntry({
      userId: user.id,
      action: "tag_bulk_delete",
      notes:
        `Deleted ${summary.ok} tag(s): ${names.slice(0, 20).join(", ")}` +
        (names.length > 20 ? ` and ${names.length - 20} more` : "") +
        `. Removed from ${summary.removedFrom} recipe tagging(s); no recipes were deleted.`,
    });
  }

  // Every row failing is still a 200: the request was understood and answered
  // row by row, which is the whole point of the shape.
  return NextResponse.json(summary);
}
