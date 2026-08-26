import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { updateTagSchema } from "@/lib/validators";
import { deleteTag, getTagById, listVisibleTags, renameTag } from "@/lib/tags";
import { logAuditEntry } from "@/lib/audit";

interface Params {
  params: { id: string };
}

/**
 * Renames a tag, merging it into an existing one on a name collision.
 *
 * The permission rule lives entirely in renameTag(): the edit reaches only
 * the recipes this user could already edit, and the tag stays put on the
 * rest. The client is expected to have shown that first (see /tags), but
 * nothing here relies on it having done so.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateTagSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const before = getTagById(params.id);
  const result = renameTag(session.user, params.id, parsed.data.name, {
    confirmMerge: parsed.data.confirmMerge,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, needsMergeConfirm: result.needsMergeConfirm ?? false },
      { status: result.status }
    );
  }

  logAuditEntry({
    userId: session.user.id,
    action: result.merged ? "tag_merge" : "tag_rename",
    notes:
      `${result.merged ? "Merged" : "Renamed"} tag "${before?.name ?? params.id}" ` +
      `into "${result.tagName}" — ${result.movedRecipes} recipe(s) updated, ` +
      `${result.lockedRecipes} left unchanged (not editable by this user)`,
  });

  return NextResponse.json({
    movedRecipes: result.movedRecipes,
    lockedRecipes: result.lockedRecipes,
    merged: result.merged,
    tagName: result.tagName,
    tags: listVisibleTags(session.user),
  });
}

/** Takes the tag off this user's recipes. Never deletes a recipe. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = deleteTag(session.user, params.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  logAuditEntry({
    userId: session.user.id,
    action: "tag_delete",
    notes:
      `Removed tag "${result.tagName}" from ${result.movedRecipes} recipe(s); ` +
      `${result.lockedRecipes} left unchanged (not editable by this user). ` +
      `No recipes were deleted.`,
  });

  return NextResponse.json({
    movedRecipes: result.movedRecipes,
    lockedRecipes: result.lockedRecipes,
    tagName: result.tagName,
    tags: listVisibleTags(session.user),
  });
}
