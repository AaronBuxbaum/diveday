/**
 * How many divers must share the identical sentence before a per-diver fact
 * becomes a fact about the boat — stated once above the list instead of
 * photocopied down it (design principle 9). One constant for the two surfaces
 * that group this way (the Guests roster and the Manifest roll call), so a
 * blocker can never be "shared" on one tab and per-diver on the other.
 *
 * Three, not two: at two the strip saves nothing (one line above versus two
 * in place) while adding a place to look, and a pair of divers missing the
 * same card is still news about those two divers rather than about the trip.
 */
export const SHARED_FACT_MIN = 3;

/**
 * Blocker codes that never group, however many divers carry them. Identity
 * confirmation is written in the singular-demonstrative voice ("this booking
 * used an existing diver's email…") because it *is* per-booking work with its
 * own confirm control on the card — "3 divers: this booking…" is a sentence
 * about one booking pinned above three (dive-domain review, 2026-08-21).
 */
export const UNGROUPABLE_BLOCKER_CODES = new Set(["identity_unconfirmed"]);
