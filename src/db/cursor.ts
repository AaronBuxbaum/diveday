import { isUuid } from "@/lib/uuid";

/**
 * Opaque keyset cursors for paged lists. A cursor is a base64url-encoded JSON
 * pair of strings — the ordered column's value and the row id — so page N+1
 * starts exactly after page N's last row even while rows are inserted between
 * requests. Not a secret, just a bookmark; anything unparsable means page 1.
 */

export function encodeCursor(sortValue: string, id: string): string {
  return Buffer.from(JSON.stringify([sortValue, id])).toString("base64url");
}

export function decodeCursor(cursor: string | undefined): [string, string] | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string" &&
      // The id half is compared against a `uuid` column (`gt(trips.id, …)` in
      // `trips-queries.ts`), and Postgres does not shrug at a malformed
      // literal — it raises `invalid input syntax for type uuid`, which is a
      // 500. "Anything unparsable means page 1" has to cover a cursor that
      // parses into the right *shape* carrying an id no column can hold; the
      // public schedule takes `?after=` from an anonymous visitor, so this is
      // the one place in this file with a caller nobody signed in.
      isUuid(parsed[1])
    ) {
      return [parsed[0], parsed[1]];
    }
  } catch {
    // Fall through: a mangled cursor is just the first page.
  }
  return null;
}
