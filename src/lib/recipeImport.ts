import { recipeSchema } from "@/lib/validators";
import { canEditSharedRecipes, type SessionUser } from "@/lib/permissions";
import { createRecipe, existingSourceUrls } from "@/lib/recipes";

/**
 * Bulk recipe import.
 *
 * The accepted format is an array of exactly what `POST /api/recipes` takes,
 * which is deliberate rather than convenient: the recipe scraper already
 * writes that shape, so importing needs no mapping layer, and the validation
 * is the same `recipeSchema` a hand-typed recipe goes through. A separate
 * import schema would be a second definition of what a recipe is.
 *
 * This also exists to retire the scraper writing SQLite directly. That path
 * has to guess a household — and a recipe with no household belongs to nobody
 * and is invisible to every user — and it bypasses the household-aware tag
 * matching in `ensureTag`, so it can duplicate tags a household already has.
 */

export interface ImportRowResult {
  /** Position in the submitted array, so a caller can point at the bad one. */
  index: number;
  name: string | null;
  status: "imported" | "skipped" | "failed";
  /** Why, for the two statuses that are not "imported". */
  reason?: string;
}

export interface ImportSummary {
  imported: number;
  skipped: number;
  failed: number;
  rows: ImportRowResult[];
}

export interface ImportOptions {
  /**
   * Forces every recipe to this visibility, whatever the file says.
   *
   * Without it a file written elsewhere decides whether recipes land in the
   * household's shared pool — which is a permission question, not the file's
   * to answer.
   */
  visibility?: "shared" | "private";
  /**
   * Import recipes whose source URL the household already has. Off by
   * default: re-running a scrape is the normal case, and silently doubling
   * the jar is not what anyone wants from it.
   */
  allowDuplicates?: boolean;
}

/**
 * Validates and inserts a batch, reporting on every row.
 *
 * One row's problem never stops the others. An import of forty recipes where
 * three have an unparseable time should store thirty-seven and say which three
 * it did not — refusing the batch would mean hand-editing a file to find out
 * what a validator already knows.
 */
export function importRecipes(
  user: SessionUser,
  householdId: string,
  items: unknown[],
  options: ImportOptions = {}
): ImportSummary {
  const rows: ImportRowResult[] = [];

  // Parsed up front so duplicate detection is one query rather than one per
  // row, and so a caller learns about a permission problem before anything is
  // written rather than halfway through.
  const parsed = items.map((item, index) => {
    const result = recipeSchema.safeParse(item);
    return { index, result };
  });

  const wantedUrls = parsed
    .filter((p) => p.result.success)
    .map((p) => (p.result.success ? p.result.data.sourceUrl : null))
    .filter((u): u is string => Boolean(u));

  const alreadyHave = options.allowDuplicates
    ? new Set<string>()
    : existingSourceUrls(householdId, wantedUrls);

  // Tracks URLs seen within this batch too, so a file containing the same
  // recipe twice imports it once.
  const seenInBatch = new Set<string>();

  for (const { index, result } of parsed) {
    if (!result.success) {
      const issue = result.error.issues[0];
      const field = issue?.path.join(".");
      rows.push({
        index,
        name: readName(items[index]),
        status: "failed",
        reason: field ? `${field}: ${issue?.message}` : (issue?.message ?? "Invalid recipe"),
      });
      continue;
    }

    const data = { ...result.data };
    if (options.visibility) data.visibility = options.visibility;

    if (data.visibility === "shared" && !canEditSharedRecipes(user)) {
      rows.push({
        index,
        name: data.name,
        status: "failed",
        reason: "Only admins can add shared recipes — import these as private instead.",
      });
      continue;
    }

    const url = data.sourceUrl || "";
    if (url && (alreadyHave.has(url) || seenInBatch.has(url))) {
      rows.push({
        index,
        name: data.name,
        status: "skipped",
        reason: "Already in the jar, by source URL.",
      });
      continue;
    }
    if (url) seenInBatch.add(url);

    createRecipe({ householdId, actingUserId: user.id, data });
    rows.push({ index, name: data.name, status: "imported" });
  }

  return {
    imported: rows.filter((r) => r.status === "imported").length,
    skipped: rows.filter((r) => r.status === "skipped").length,
    failed: rows.filter((r) => r.status === "failed").length,
    rows,
  };
}

/**
 * A name to report a failed row by, dug out of input that did not validate.
 *
 * A row that failed has no parsed name, and "row 17 failed" is a worse message
 * than "Chilli failed" when the point is to find it in the file.
 */
function readName(item: unknown): string | null {
  if (item && typeof item === "object" && "name" in item) {
    const name = (item as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) return name.trim().slice(0, 120);
  }
  return null;
}

/**
 * Pulls the recipe array out of a submitted payload.
 *
 * Accepts a bare array (what the scraper writes) or an object wrapping one
 * under `recipes` (what Pickl's own export writes, so the file can carry a
 * version alongside the data). Anything else is rejected by name, because
 * "Invalid input" on a file you just exported is a maddening message.
 */
export function readRecipeArray(
  body: unknown
): { ok: true; items: unknown[] } | { ok: false; error: string } {
  if (Array.isArray(body)) return { ok: true, items: body };

  if (body && typeof body === "object" && "recipes" in body) {
    const inner = (body as { recipes?: unknown }).recipes;
    if (Array.isArray(inner)) return { ok: true, items: inner };
    return { ok: false, error: 'The "recipes" property is not a list of recipes.' };
  }

  return {
    ok: false,
    error:
      "Expected a list of recipes, or an object with a \"recipes\" list — which is what Pickl's own export gives you.",
  };
}
