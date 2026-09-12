/**
 * Turns a pasted recipe into a draft.
 *
 * The point of this file is the thing a household member actually has: a
 * recipe in a note, an email from a relative, a block of text off a website.
 * Not a file format — no format at all.
 *
 * ---------------------------------------------------------------------------
 * Why heuristics are acceptable here
 * ---------------------------------------------------------------------------
 * Everything below is a guess, and some of the guesses will be wrong. That is
 * affordable because nothing here saves anything: the result is handed to the
 * recipe form for the person to look at and correct before it is stored. A
 * wrong split costs one drag of the mouse; the alternative — refusing anything
 * that is not in a known format — costs the whole feature.
 *
 * It follows that this must never silently DISCARD text. Every line ends up
 * in one of the fields, and when the parser cannot tell what a line is it goes
 * to instructions, which is the field a person reads anyway.
 */

export interface RecipeDraft {
  name: string;
  ingredients: string;
  instructions: string;
  prepTimeMinutes: string;
  cookTimeMinutes: string;
  servings: string;
  sourceUrl: string;
  notes: string;
}

/** Headings that mark the start of an ingredient list. */
const INGREDIENT_HEADINGS =
  /^\s*#{0,6}\s*(ingredients?|you(?:'| wi)ll need|shopping list)\s*:?\s*$/i;

/** Headings that mark the start of the method. */
const INSTRUCTION_HEADINGS =
  /^\s*#{0,6}\s*(instructions?|directions?|method|steps?|preparation|how to make it)\s*:?\s*$/i;

/** Headings that mark trailing prose we should keep but not treat as method. */
const NOTES_HEADINGS = /^\s*#{0,6}\s*(notes?|tips?|variations?)\s*:?\s*$/i;

/**
 * A line that is only a quantity-ish fragment, e.g. "2 lbs ground beef",
 * "1/2 cup sugar", "3 eggs", "Salt and pepper to taste".
 *
 * Used only when the paste has no headings at all. Deliberately loose: a false
 * positive puts a line of method in the ingredients box, which the person
 * fixes in a second, where a false negative buries an ingredient in a wall of
 * instructions where they will not notice it missing.
 */
const LOOKS_LIKE_INGREDIENT = new RegExp(
  [
    // Starts with a number, fraction, or unicode vulgar fraction.
    "^\\s*(?:[0-9]+([./][0-9]+)?|[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])",
    // Or a bullet.
    "|^\\s*[-*•·]\\s+",
    // Or a bare measure word up front.
    "|^\\s*(a|an|one|two|three|four|five|six|pinch|dash|handful|salt|pepper)\\b",
  ].join(""),
  "i"
);

/** "Prep: 20 min", "Prep time 1 hr 10 mins", "Active time: 15 minutes". */
const PREP_LINE = /\b(?:prep(?:aration)?|active)\s*(?:time)?\s*[:\-]?\s*(.+)$/i;
/** "Cook: 45 minutes", "Bake time 1 hour", "Total time: 55 min". */
const COOK_LINE = /\b(?:cook(?:ing)?|bake|baking|total|inactive)\s*(?:time)?\s*[:\-]?\s*(.+)$/i;
/** "Serves 4", "Servings: 6", "Yield: 12 cookies", "Makes 24". */
const SERVES_LINE = /\b(?:serves|servings?|yields?|makes)\s*[:\-]?\s*(.+)$/i;

const URL_ONLY = /^\s*(https?:\/\/\S+)\s*$/i;

/**
 * Minutes out of a human duration: "1 hr 10 mins", "90 minutes", "1.5 hours".
 *
 * Returns null rather than 0 when nothing parses, so an unreadable time leaves
 * the field empty instead of asserting a recipe takes no time at all.
 */
export function parseDurationMinutes(raw: string): number | null {
  const text = raw.toLowerCase();
  let total = 0;
  let matched = false;

  for (const m of text.matchAll(/([0-9]+(?:\.[0-9]+)?)\s*(h(?:ou)?rs?|h\b|m(?:in(?:ute)?s?)?\b)/g)) {
    const value = Number(m[1]);
    if (!Number.isFinite(value)) continue;
    total += m[2].startsWith("h") ? value * 60 : value;
    matched = true;
  }
  if (matched) return Math.round(total);

  // A bare number with no unit, as in "Prep: 20". Minutes is the only sane
  // reading for a recipe.
  const bare = text.match(/^\s*([0-9]+(?:\.[0-9]+)?)\s*$/);
  if (bare) return Math.round(Number(bare[1]));

  return null;
}

/** First integer in the text: "6", "12 cookies", "about 4 people". */
export function parseServings(raw: string): number | null {
  const m = raw.match(/([0-9]+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

const EMPTY: RecipeDraft = {
  name: "",
  ingredients: "",
  instructions: "",
  prepTimeMinutes: "",
  cookTimeMinutes: "",
  servings: "",
  sourceUrl: "",
  notes: "",
};

/**
 * Parses pasted text into a draft for the recipe form.
 *
 * Two passes. The first pulls out the lines that announce themselves — a bare
 * URL, "Serves 4", "Prep: 20 min" — because those are unambiguous wherever
 * they appear. The second splits what is left into ingredients and method,
 * preferring explicit headings and falling back to a shape heuristic.
 */
export function parseRecipeText(input: string): RecipeDraft {
  if (!input.trim()) return { ...EMPTY };

  const rawLines = input.replace(/\r\n?/g, "\n").split("\n");

  let sourceUrl = "";
  let prep: number | null = null;
  let cook: number | null = null;
  let servings: number | null = null;
  const kept: string[] = [];

  for (const line of rawLines) {
    const trimmed = line.trim();

    const url = trimmed.match(URL_ONLY);
    if (url && !sourceUrl) {
      sourceUrl = url[1];
      continue;
    }

    // Order matters: "Total time" must be tested before the servings pattern,
    // and a line is consumed by at most one of these.
    const prepMatch = trimmed.match(PREP_LINE);
    if (prep === null && prepMatch && trimmed.length < 60) {
      const parsed = parseDurationMinutes(prepMatch[1]);
      if (parsed !== null) {
        prep = parsed;
        continue;
      }
    }

    const cookMatch = trimmed.match(COOK_LINE);
    if (cook === null && cookMatch && trimmed.length < 60) {
      const parsed = parseDurationMinutes(cookMatch[1]);
      if (parsed !== null) {
        cook = parsed;
        continue;
      }
    }

    const servesMatch = trimmed.match(SERVES_LINE);
    if (servings === null && servesMatch && trimmed.length < 60) {
      const parsed = parseServings(servesMatch[1]);
      if (parsed !== null) {
        servings = parsed;
        continue;
      }
    }

    kept.push(line);
  }

  // --- the title -----------------------------------------------------------
  // First non-empty line, with any markdown heading marker taken off. A recipe
  // pasted from anywhere leads with its name.
  let name = "";
  let bodyStart = 0;
  for (let i = 0; i < kept.length; i++) {
    const trimmed = kept[i].trim();
    if (!trimmed) continue;
    // Unless the first line is itself a section heading, in which case the
    // paste began at the ingredients and there is no title to take.
    if (
      INGREDIENT_HEADINGS.test(trimmed) ||
      INSTRUCTION_HEADINGS.test(trimmed) ||
      NOTES_HEADINGS.test(trimmed)
    ) {
      bodyStart = i;
      break;
    }
    name = trimmed.replace(/^#{1,6}\s*/, "").replace(/\s*[:.]$/, "");
    bodyStart = i + 1;
    break;
  }

  const body = kept.slice(bodyStart);

  // --- ingredients and method ---------------------------------------------
  const ingredients: string[] = [];
  const instructions: string[] = [];
  const notes: string[] = [];

  const hasHeadings = body.some(
    (l) =>
      INGREDIENT_HEADINGS.test(l.trim()) ||
      INSTRUCTION_HEADINGS.test(l.trim()) ||
      NOTES_HEADINGS.test(l.trim())
  );

  if (hasHeadings) {
    // Headings are explicit, so follow them and guess nothing. Anything before
    // the first heading is treated as ingredients, which is where a stray
    // preamble most often belongs.
    let bucket: "ingredients" | "instructions" | "notes" = "ingredients";
    for (const line of body) {
      const trimmed = line.trim();
      if (INGREDIENT_HEADINGS.test(trimmed)) {
        bucket = "ingredients";
        continue;
      }
      if (INSTRUCTION_HEADINGS.test(trimmed)) {
        bucket = "instructions";
        continue;
      }
      if (NOTES_HEADINGS.test(trimmed)) {
        bucket = "notes";
        continue;
      }
      (bucket === "ingredients" ? ingredients : bucket === "instructions" ? instructions : notes)
        .push(line);
    }
  } else {
    // No headings: the ingredients run until the text stops looking like a
    // list. A line that does not look like an ingredient is held back rather
    // than assigned, because what it turns out to be depends on what follows:
    //
    //   - another ingredient after it -> it was interior prose, and belongs
    //     with the ingredients ("all at room temperature");
    //   - a second non-ingredient line -> the list has ended and both are
    //     method;
    //   - the end of the input -> it is a one-line method, which is how a
    //     quick paste usually reads. Buffering is what makes this case work;
    //     counting misses left it stranded in the ingredients box.
    let inIngredients = true;
    let held: string[] = [];
    for (const line of body) {
      const trimmed = line.trim();

      if (!inIngredients) {
        instructions.push(line);
        continue;
      }

      // Blank lines decide nothing. They travel with whatever is pending so
      // the original spacing survives either verdict.
      if (!trimmed) {
        (held.length ? held : ingredients).push(line);
        continue;
      }

      if (LOOKS_LIKE_INGREDIENT.test(trimmed) && trimmed.length < 120) {
        ingredients.push(...held, line);
        held = [];
        continue;
      }

      held.push(line);
      if (held.filter((l) => l.trim()).length >= 2) {
        inIngredients = false;
        instructions.push(...held);
        held = [];
      }
    }
    // Whatever is still pending never got a second opinion, so it is the
    // method.
    if (held.length) instructions.push(...held);
  }

  const tidy = (lines: string[]) => lines.join("\n").trim();

  return {
    name,
    ingredients: tidy(ingredients),
    instructions: tidy(instructions),
    prepTimeMinutes: prep === null ? "" : String(prep),
    cookTimeMinutes: cook === null ? "" : String(cook),
    servings: servings === null ? "" : String(servings),
    sourceUrl,
    notes: tidy(notes),
  };
}
