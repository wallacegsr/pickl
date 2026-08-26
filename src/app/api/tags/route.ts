import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createTagSchema } from "@/lib/validators";
import { createTag, listVisibleTags } from "@/lib/tags";
import { logAuditEntry } from "@/lib/audit";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(listVisibleTags(session.user));
}

/**
 * Creates a standalone tag — one attached to no recipe at all.
 *
 * Nothing about a recipe changes here, so there is no permission check
 * beyond being signed in: the tag vocabulary is the household's, and an
 * empty tag has no effect on anybody's recipes until somebody puts it on
 * one (which their own recipe permissions still gate).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createTagSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const result = createTag(session.user, parsed.data.name);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  logAuditEntry({
    userId: session.user.id,
    action: "tag_create",
    notes: `Created tag "${result.tagName}"`,
  });

  return NextResponse.json({ tags: listVisibleTags(session.user) }, { status: 201 });
}
