import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { recipes, recipeTags, tags, users } from "@/db/schema";
import { normalizeTagName, tagKey } from "@/lib/tagNames";
import type { SessionUser } from "@/lib/permissions";

/** Chips a person can pick for themselves, and how many the default offers. */
export const MAX_PICKER_CHIPS = 8;

export interface PickerChips {
  /** Tag names, in the order they are shown. */
  tags: string[];
  /** True when this person chose them; false for the household's usual tags. */
  custom: boolean;
}

/**
 * The tag chips the recipe picker offers.
 *
 * Favourites and "quick" are always there — they are questions, not tags — so
 * this is only about which tags earn a place beside them. With no choice
 * saved, that is whichever tags this household actually uses most, counted
 * over the recipes this person can see; a household that never tags anything
 * gets no chips rather than a row of empty ones.
 */
export function pickerChipsFor(user: SessionUser, householdId: string): PickerChips {
  const saved = db
    .select({ chips: users.pickerChips })
    .from(users)
    .where(eq(users.id, user.id))
    .get()?.chips;

  const chosen = parsePickerChips(saved ?? "");
  if (chosen.length > 0) return { tags: chosen, custom: true };

  return { tags: defaultPickerChips(user, householdId), custom: false };
}

/**
 * The tags the picker offers when nobody has chosen: the household's
 * most-used, counted over the recipes this person can see. Also what the
 * preferences panel shows beside "Default", so the option names real tags.
 */
export function defaultPickerChips(user: SessionUser, householdId: string): string[] {
  const rows = db
    .select({ name: sql<string>`min(${tags.name})`, uses: sql<number>`count(*)` })
    .from(recipeTags)
    .innerJoin(tags, eq(tags.id, recipeTags.tagId))
    .innerJoin(recipes, eq(recipes.id, recipeTags.recipeId))
    .where(
      and(
        eq(recipes.householdId, householdId),
        // The shared pool plus this person's own private recipes — the same
        // rule the recipe list uses.
        sql`(${recipes.visibility} = 'shared' OR ${recipes.ownerUserId} = ${user.id})`
      )
    )
    .groupBy(tags.nameKey)
    .orderBy(desc(sql`count(*)`), sql`min(${tags.name}) COLLATE NOCASE`)
    .limit(MAX_PICKER_CHIPS)
    .all();

  return rows.map((r) => r.name);
}

/** Stored form -> names, de-duplicated and capped. */
export function parsePickerChips(stored: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of stored.split(",")) {
    const name = normalizeTagName(raw);
    if (!name || seen.has(tagKey(name))) continue;
    seen.add(tagKey(name));
    out.push(name);
    if (out.length >= MAX_PICKER_CHIPS) break;
  }
  return out;
}

/** Names -> stored form. An empty list means "use the default set". */
export function formatPickerChips(names: string[]): string {
  return parsePickerChips(names.join(",")).join(",");
}
