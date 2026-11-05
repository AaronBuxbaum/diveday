/**
 * **The deck count** (loop 5, row 1; glossary "Deck count"): the heads the
 * captain counts on deck at a roll-call checkpoint, typed in as one number and
 * held against the manifest.
 *
 * The roll call's own head count is the sum of per-person marks, so a mark
 * made against the wrong name still reads as a full boat. The deck count is a
 * second, independent count, the way every real crew works: the app agrees or
 * names the gap. **It informs and never gates**: nothing closes, opens,
 * refuses or allows anything on it, and the checkpoint's completeness stays
 * the per-person marks' (`rollCallCompleteness`).
 *
 * Passengers only (divers, snorkelers, riders), never crew: the number it is
 * held against is the head count's own denominator, which counts passengers.
 */

/** The largest count the form takes; past it is a typo, not a boat. */
export const DECK_COUNT_MAX = 999;

/** A whole number of heads, zero to {@link DECK_COUNT_MAX}. */
export function isDeckCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= DECK_COUNT_MAX;
}

export type DeckCountInput = {
  /** The heads the captain counted on deck. */
  counted: number;
  /**
   * Who the manifest expects aboard at this checkpoint: the head count's own
   * denominator (everyone at the dock still expected, or everyone who went
   * out), never the roster.
   */
  expected: number;
  /** Passengers marked aboard at this checkpoint (`summary.boarded`). */
  markedAboard: number;
  /** Expected passengers with no mark at this checkpoint, by name. */
  unmarked: readonly string[];
  /** Passengers recorded not back aboard at this checkpoint, by name (always none at the dock). */
  notBackAboard: readonly string[];
};

export type DeckCountReading = {
  /**
   * The deck, the manifest and the marks all say the same number, and nobody
   * is recorded not back aboard. Two counts that disagree about a person in
   * the water never read as agreeing (dock review M1).
   */
  agrees: boolean;
  counted: number;
  expected: number;
  markedAboard: number;
  /**
   * More people marked aboard than counted on deck: a mark may be on the
   * wrong person. The case the count exists for.
   */
  marksExceedCount: boolean;
  unmarked: readonly string[];
  notBackAboard: readonly string[];
};

/**
 * **A count older than the newest mark at its checkpoint is stale** (dock
 * review M2): the marks moved after the captain counted, so the page asks for
 * a recount rather than agreeing or disagreeing with numbers nobody counted.
 */
export function isDeckCountStale(recordedAt: Date, latestMarkAt: Date | null): boolean {
  return latestMarkAt !== null && latestMarkAt.getTime() > recordedAt.getTime();
}

/** Hold one deck count against the manifest. Codes and numbers; the page picks the words. */
export function readDeckCount(input: DeckCountInput): DeckCountReading {
  return {
    agrees:
      input.counted === input.expected &&
      input.markedAboard === input.counted &&
      input.notBackAboard.length === 0,
    counted: input.counted,
    expected: input.expected,
    markedAboard: input.markedAboard,
    marksExceedCount: input.markedAboard > input.counted,
    unmarked: input.unmarked,
    notBackAboard: input.notBackAboard,
  };
}
