import { isUuid } from "@/lib/uuid";

/**
 * Opaque keyset cursors for paged lists. A cursor is a base64url-encoded JSON
 * triple of strings — the ordered column's value, the tiebreak a person can
 * predict (a departure's title), and the row id — so page N+1 starts exactly
 * after page N's last row even while rows are inserted between requests. Not a
 * secret, just a bookmark; anything unparsable means page 1.
 *
 * The middle key is there because the list it pages orders by (start, title,
 * id) (issue #2175): two boats at the same minute in title order, and a cursor
 * of (start, id) alone would skip or repeat one at a page boundary between
 * them. A pair from before it is unparsable like anything else.
 */

export function encodeCursor(sortValue: string, tiebreak: string, id: string): string {
  return Buffer.from(JSON.stringify([sortValue, tiebreak, id])).toString("base64url");
}

export function decodeCursor(cursor: string | undefined): [string, string, string] | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      Array.isArray(parsed) &&
      parsed.length === 3 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string" &&
      typeof parsed[2] === "string" &&
      // The id half is compared against a `uuid` column (`gt(trips.id, …)` in
      // `trips-queries.ts`), and Postgres does not shrug at a malformed
      // literal — it raises `invalid input syntax for type uuid`, which is a
      // 500. "Anything unparsable means page 1" has to cover a cursor that
      // parses into the right *shape* carrying an id no column can hold; the
      // public schedule takes `?after=` from an anonymous visitor, so this is
      // the one place in this file with a caller nobody signed in.
      isUuid(parsed[2]) &&
      // The other two halves reach Postgres too, as a `timestamptz` and a
      // `text` parameter, from the same anonymous `?after=`. A NUL in the
      // title or a date outside what the column holds (an extended-year
      // `+275760-…`) is a 500 there, not an empty page, so both are page one
      // here (security review of issue #2175).
      isStartInRange(parsed[0]) &&
      isTitleTiebreak(parsed[1])
    ) {
      return [parsed[0], parsed[1], parsed[2]];
    }
  } catch {
    // Fall through: a mangled cursor is just the first page.
  }
  return null;
}

/** The longest title a cursor may carry; a departure title is far shorter. */
const MAX_CURSOR_TITLE = 500;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

function isTitleTiebreak(title: string): boolean {
  return title.length <= MAX_CURSOR_TITLE && !CONTROL_CHARACTER.test(title);
}

function isStartInRange(start: string): boolean {
  const ms = Date.parse(start);
  if (Number.isNaN(ms)) return false;
  const year = new Date(ms).getUTCFullYear();
  return year >= 1970 && year <= 9999;
}
