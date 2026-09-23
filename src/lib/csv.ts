/**
 * One CSV field, safe to open in a spreadsheet.
 *
 * Quoted when it holds a comma, quote or line break (\r included, which Excel
 * treats as a row break too). And defused when it starts with a character a
 * spreadsheet would read as a formula — = + - @, tab or carriage return — by
 * prefixing an apostrophe. Recipe names, ingredients and tags are typed by
 * household members, so without this a recipe called
 * `=HYPERLINK("http://evil.example","Click")` becomes a live formula in the
 * admin's spreadsheet when they open an export.
 */
export function csvField(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
