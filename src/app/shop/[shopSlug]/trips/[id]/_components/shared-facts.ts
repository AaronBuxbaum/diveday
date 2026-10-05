/**
 * How many divers must share the identical depth advisory before it becomes a
 * fact about the dive plan — stated once above the list instead of photocopied
 * down it (design principle 9). One constant for the two surfaces that group
 * this way (the Divers roster and the Boat tab's roll call).
 *
 * Three, not two: at two the strip saves nothing (one line above versus two
 * in place) while adding a place to look.
 *
 * **Blockers never group** (Aaron, 2026-10-05). A shared line is only worth
 * its pointer when there is something to do about all of them at once, and a
 * blocker is cleared diver by diver; "1 blocker shared with other divers,
 * listed above" named neither the problem nor the fix.
 */
export const SHARED_FACT_MIN = 3;
