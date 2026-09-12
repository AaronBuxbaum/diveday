import { describe, expect, it } from "vitest";
import { DIVER_LOCALES } from "./settings";
import { STAFF_MESSAGES } from "./staff-messages";

/**
 * **The two sentences the counter's no-show door lives or dies on** (issue
 * #1209, dive-domain-expert review 2026-09-11).
 *
 * `checkIn.noShow.consequence` is what a staffer reads while deciding whether
 * to tap over a diver who is fifteen minutes late and not answering their
 * phone. Until 2026-09-11 it ended "You can put them back." flat, and that is
 * a promise the product cannot keep: `undoBookingNoShow` (src/db/no-show.ts)
 * re-counts the boat under the lock and refuses `trip_full` —
 * `course_ratio_full` too — the moment the freed seat is taken, and the
 * salvage panel that renders one tap later exists to get it taken as fast as
 * possible. The page's notice map already conceded it, calling
 * `no-show-trip-full` the one refusal a staffer genuinely could not have seen
 * coming. They could have, if the confirm had said so.
 */
const CONDITION = {
  "en-US": /while/i,
  "es-ES": /mientras/i,
} as const satisfies Record<(typeof DIVER_LOCALES)[number], RegExp>;

const UNDO = {
  "en-US": /put them back/i,
  "es-ES": /volver a ponerlo/i,
} as const satisfies Record<(typeof DIVER_LOCALES)[number], RegExp>;

/**
 * The two states the counter refuses in, which English keeps apart and Spanish
 * had collapsed: a seat the *diver* gave up (cancelled — the `not_booked`
 * gate) against a seat the *shop* freed (the no-show mark). `src/lib/no-show.ts`
 * argues that distinction is the whole difference between a courtesy and an
 * accusation, and both sentences can land on the same screen minutes apart, so
 * they may not share a verb.
 */
const CANCELLED = {
  "en-US": /given up/i,
  "es-ES": /se cancel/i,
} as const satisfies Record<(typeof DIVER_LOCALES)[number], RegExp>;

const RELEASED = {
  "en-US": /freed/i,
  "es-ES": /liber/i,
} as const satisfies Record<(typeof DIVER_LOCALES)[number], RegExp>;

/**
 * **The second salvage offer names the diver it is for** (dive-domain-expert
 * review, 2026-09-11). When nobody is waiting, what is left to salvage is not
 * the seat — no other departure can take a seat on this one — but the day of
 * the person the seat was taken from. Worded as departures that "still have
 * room", the panel left a staffer guessing between rebooking the diver who
 * just missed and finding a stranger, directly above the sentence saying the
 * mark charges and refunds nothing. The name is what settles it, so neither
 * locale may drop it.
 */
const NAMES_THE_DIVER = /\{name\}/;

describe("the counter's no-show copy", () => {
  for (const locale of DIVER_LOCALES) {
    it(`conditions the undo the confirm offers in ${locale}`, () => {
      const consequence = STAFF_MESSAGES[locale].checkIn.noShow.consequence;

      // Still offered — the Undo is the whole reason the released row stays on
      // the page — but no longer offered as free.
      expect(consequence, locale).toMatch(UNDO[locale]);
      expect(consequence, locale).toMatch(CONDITION[locale]);
    });

    it(`names the diver the rebooking offer is for in ${locale}`, () => {
      expect(STAFF_MESSAGES[locale].checkIn.noShow.rebook, locale).toMatch(NAMES_THE_DIVER);
    });

    it(`keeps a cancelled seat and a freed one apart in ${locale}`, () => {
      const notice = STAFF_MESSAGES[locale].checkIn.notice;

      // `not_booked` fires only on a cancellation: the diver told the shop.
      expect(notice.noShowNotBooked, locale).toMatch(CANCELLED[locale]);
      expect(notice.noShowNotBooked, locale).not.toMatch(RELEASED[locale]);

      // The release verb belongs to the seat the shop wrote off, and to that
      // sentence only.
      expect(notice.noShowTripFull, locale).toMatch(RELEASED[locale]);
      expect(notice.noShowTripFull, locale).not.toMatch(CANCELLED[locale]);
    });
  }
});
