/**
 * **The deck count** (issue #4248): the number of heads a captain counted on
 * deck at one roll-call checkpoint, crew included, held against the people the
 * roll call has marked aboard there. A difference is a fact for a human to
 * look at, said calmly beside the head count. It never gates a departure and
 * never closes or reopens a checkpoint: the per-person roll call stays the
 * head count (ADR 20260804-crew-roll-call-is-per-person, amended for this).
 */

/** The largest count the form takes; the table's check says the same. */
export const DECK_COUNT_MAX = 999;

/**
 * A typed count, or null for anything that is not a whole number from 0 to
 * {@link DECK_COUNT_MAX}. An empty box is null, never zero: a zero the captain
 * did not type would read as an empty boat.
 */
export function parseDeckCount(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const counted = Number(trimmed);
  return counted <= DECK_COUNT_MAX ? counted : null;
}

export type DeckCountComparison =
  | { kind: "matches"; counted: number }
  | { kind: "differs"; counted: number; aboard: number };

/**
 * The newest deck count against the people marked aboard at the same
 * checkpoint. Null when nobody has entered one, which says nothing.
 */
export function compareDeckCount(
  counted: number | null,
  aboard: number,
): DeckCountComparison | null {
  if (counted === null) return null;
  return counted === aboard ? { kind: "matches", counted } : { kind: "differs", counted, aboard };
}
