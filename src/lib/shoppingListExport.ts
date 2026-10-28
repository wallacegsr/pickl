import { csvField } from "@/lib/csv";
import type { MealType } from "@/db/schema";

export interface ExportIngredient {
  ingredientText: string;
  onHand: boolean;
}

export interface ExportMeal {
  mealType: MealType;
  recipeName: string;
  ingredients: ExportIngredient[];
}

export interface ExportDay {
  date: string;
  dayOfWeek: string;
  meals: ExportMeal[];
}

/** Something added to the list by hand rather than by a planned recipe. */
export interface ExportExtra {
  text: string;
  onHand: boolean;
}

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

/** Plain-text checklist, grouped by day/meal, using unicode checkbox glyphs; extras last. */
export function buildShoppingListText(days: ExportDay[], extras: ExportExtra[] = []): string {
  if (days.length === 0 && extras.length === 0) return "No meals planned.";

  const lines: string[] = [];
  for (const day of days) {
    lines.push(`${day.dayOfWeek}, ${day.date}`);
    lines.push("=".repeat(`${day.dayOfWeek}, ${day.date}`.length));
    lines.push("");
    for (const meal of day.meals) {
      lines.push(`${MEAL_LABELS[meal.mealType]} — ${meal.recipeName}`);
      if (meal.ingredients.length === 0) {
        // Ingredients are optional on a recipe; a bare heading reads like a
        // truncated file, so say why it is empty.
        lines.push("  (no ingredients listed)");
      }
      for (const ing of meal.ingredients) {
        lines.push(`  ${ing.onHand ? "☑" : "☐"} ${ing.ingredientText}`);
      }
      lines.push("");
    }
  }
  if (extras.length > 0) {
    lines.push("Extras");
    lines.push("======");
    lines.push("");
    for (const extra of extras) lines.push(`  ${extra.onHand ? "☑" : "☐"} ${extra.text}`);
  }
  return lines.join("\n").trimEnd() + "\n";
}

/** One row per ingredient: Date, Day, Meal, Recipe, Ingredient, On Hand. Extras have Meal "Extra". */
export function buildShoppingListCsv(days: ExportDay[], extras: ExportExtra[] = []): string {
  const header = ["Date", "Day", "Meal", "Recipe", "Ingredient", "On Hand"];
  const rows = [header];
  for (const day of days) {
    for (const meal of day.meals) {
      for (const ing of meal.ingredients) {
        rows.push([
          day.date,
          day.dayOfWeek,
          MEAL_LABELS[meal.mealType],
          meal.recipeName,
          ing.ingredientText,
          ing.onHand ? "Yes" : "No",
        ]);
      }
    }
  }
  for (const extra of extras) {
    rows.push(["", "", "Extra", "", extra.text, extra.onHand ? "Yes" : "No"]);
  }
  return rows.map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Rich-text HTML checklist for the clipboard: real (disabled, pre-checked
 * where on-hand) checkbox inputs inside a plain list, for apps that honor
 * pasted HTML (Google Docs, Word, Notion, Apple Notes). Apps that only
 * accept plain text (e.g. Google Keep, which auto-itemizes pasted lines
 * into an existing checklist note) fall back to the text/plain payload
 * written alongside this.
 */
export function buildShoppingListHtml(days: ExportDay[], extras: ExportExtra[] = []): string {
  if (days.length === 0 && extras.length === 0) return "<p>No meals planned.</p>";

  const parts: string[] = [];
  for (const day of days) {
    parts.push(`<h3>${escapeHtml(day.dayOfWeek)}, ${escapeHtml(day.date)}</h3>`);
    for (const meal of day.meals) {
      parts.push(
        `<p><strong>${escapeHtml(MEAL_LABELS[meal.mealType])} — ${escapeHtml(
          meal.recipeName
        )}</strong></p>`
      );
      parts.push('<ul style="list-style:none;padding-left:0;margin:0 0 12px 0;">');
      for (const ing of meal.ingredients) {
        parts.push(
          `<li><label><input type="checkbox" disabled${
            ing.onHand ? " checked" : ""
          } /> ${escapeHtml(ing.ingredientText)}</label></li>`
        );
      }
      parts.push("</ul>");
    }
  }
  if (extras.length > 0) {
    parts.push("<h3>Extras</h3>");
    parts.push('<ul style="list-style:none;padding-left:0;margin:0 0 12px 0;">');
    for (const extra of extras) {
      parts.push(
        `<li><label><input type="checkbox" disabled${
          extra.onHand ? " checked" : ""
        } /> ${escapeHtml(extra.text)}</label></li>`
      );
    }
    parts.push("</ul>");
  }
  return parts.join("\n");
}

export function shoppingListFilename(
  week: string,
  mode: "today" | "week",
  format: "txt" | "csv"
): string {
  return `shopping-list-${week}-${mode}.${format}`;
}
