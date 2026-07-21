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
      typeof parsed[1] === "string"
    ) {
      return [parsed[0], parsed[1]];
    }
  } catch {
    // Fall through: a mangled cursor is just the first page.
  }
  return null;
}
