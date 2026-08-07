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
