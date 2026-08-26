/**
 * Tag-name rules, with no database import.
 *
 * Kept separate from src/lib/tags.ts on purpose: the recipe form is a client
 * component and needs to split and re-join the comma-separated box, while
 * tags.ts pulls in `@/db` and can only ever run on the server.
 */

/**
 * Tag names, normalized.
 *
 * Two rules, and only two: surrounding/inner whitespace is collapsed, and
 * comparison is case-INSENSITIVE. "Quick", "quick" and " quick " are all the
 * same tag; whichever spelling created it is the one everybody sees. The
 * case-folded form is stored alongside the display name in `tags.nameKey`
 * and carries the UNIQUE constraint, so the rule is enforced by the database
 * rather than by whoever remembers to call this function.
 */
export function normalizeTagName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function tagKey(raw: string): string {
  return normalizeTagName(raw).toLowerCase();
}

export const MAX_TAG_LENGTH = 60;

/** Splits the recipe form's comma-separated box into distinct tag names. */
export function parseTagInput(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of input.split(",")) {
    const name = normalizeTagName(piece);
    if (!name) continue;
    const key = tagKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name.slice(0, MAX_TAG_LENGTH));
  }
  return out;
}

/** Renders tag names back into the comma-separated form the UI types in. */
export function formatTagInput(names: string[]): string {
  return names.join(", ");
}
