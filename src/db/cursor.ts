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
      isUuid(parsed[2])
    ) {
      return [parsed[0], parsed[1], parsed[2]];
    }
  } catch {
    // Fall through: a mangled cursor is just the first page.
  }
  return null;
}
