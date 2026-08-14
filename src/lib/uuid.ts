/**
 * The one UUID shape-check. Before this file the same regex lived in four
 * modules under two names — and one copy had quietly tightened itself to
 * version-4-only, so the "same" check gave different answers depending on
 * which file you were in.
 *
 * Deliberately version-agnostic: every id this app mints is Postgres
 * `gen_random_uuid()` (v4), but the check exists to keep arbitrary user input
 * out of an `eq(id, …)` clause, not to police UUID versions — a v7 id pasted
 * from a future migration should still be looked up, and simply not match a
 * row if it isn't one of ours.
 */
/** The bare pattern (no anchors), for callers composing a larger regex. */
export const UUID_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const UUID_PATTERN = new RegExp(`^${UUID_SOURCE}$`, "i");

/** A real uuid, not "36 characters of hex and hyphens". */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * A URL-supplied id (a `searchParams` value, a dynamic path segment) narrowed
 * to something a `uuid` column can actually be compared against — or
 * `undefined`, which every caller already handles as "no filter".
 *
 * This exists because the alternative is a 500. Postgres does not coerce a
 * malformed literal in `"orders"."person_id" = $1`; it raises `invalid input
 * syntax for type uuid`, so a truncated link in a chat message or a
 * hand-edited URL takes down a staff page that every other malformed
 * filter (`?status=`, `?from=`, `?to=`) treats as simply not a filter.
 *
 * Deliberately here at the URL boundary rather than inside `src/db`: a query
 * helper that silently dropped a filter it could not parse would hide a real
 * bug from a caller holding a genuine id. Only the layer that knows the string
 * came from a user gets to shrug at it.
 *
 * A *required* id — a path segment the page cannot render without — pairs this
 * with the page's own `notFound()`: an unparseable id names no row, which is a
 * 404, not a 500.
 */
export function uuidParam(value: string | null | undefined): string | undefined {
  return value && isUuid(value) ? value : undefined;
}
