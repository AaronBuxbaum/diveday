import { describe, expect, it } from "vitest";
import { DIVER_LOCALES } from "./settings";
import { STAFF_MESSAGES } from "./staff-messages";

/**
 * **What "Private charter" actually buys a shop** (issue #1465).
 *
 * The box writes one column, `trips.is_private`, and every public *listing*
 * honours it — `src/db/trip-stages.ts`, `src/db/dive-sites.ts` and
 * `src/db/booking-handoff.ts` all filter `eq(trips.isPrivate, false)`. The
 * departure's own page does not: `getTripWithBooked` (src/db/trips-record.ts)
 * keys on id, shop and `liveTrip()` and nothing else, so
 * `/s/{shop}/trips/{id}` renders the site, the times, the crew and the price
 * to anyone holding the URL, signed in or not. Unlisted, not private.
 *
 * That is the intended behaviour — the owner's call, 2026-09-11 — so the fix
 * is the sentence, not the query. Until then `isPrivateHint` read "Only divers
 * with the link can book it.", which is true about booking and silent about
 * reading, and a shop that promises a chartering diver their day is unlisted
 * has been let down by the half a sentence it was never told.
 *
 * The hint therefore owes two things in every locale: the reader is *anyone*,
 * not a screened diver, and what they can do is read the departure as well as
 * take a seat on it. It is rendered twice — the board's builder
 * (`schedule/board/_components/ScheduleBuilder.tsx`) and a departure's Details
 * panel (`trips/[id]/_components/DetailsSection.tsx`) — from this one key.
 */
const ANYONE = {
  "en-US": /anyone/i,
  "es-ES": /cualquiera/i,
} as const satisfies Record<(typeof DIVER_LOCALES)[number], RegExp>;

/** The half the old sentence left out: holding the link is enough to read it. */
const CAN_READ = {
  "en-US": /\bsee\b/i,
  "es-ES": /\bver\b/i,
} as const satisfies Record<(typeof DIVER_LOCALES)[number], RegExp>;

/** The half it did state, and which the rewrite may not drop. */
const CAN_BOOK = {
  "en-US": /\bbook\b/i,
  "es-ES": /reservar/i,
} as const satisfies Record<(typeof DIVER_LOCALES)[number], RegExp>;

/**
 * "Only divers with the link…" — the shape that reads as a gate. A shop that
 * meets this word next to a checkbox called "Private charter" concludes the
 * app is checking something, and nothing is.
 */
const GATE = {
  "en-US": /\bonly\b/i,
  "es-ES": /\bsolo\b/i,
} as const satisfies Record<(typeof DIVER_LOCALES)[number], RegExp>;

describe("the private-charter checkbox's hint", () => {
  for (const locale of DIVER_LOCALES) {
    it(`says anyone with the link can read the departure in ${locale}`, () => {
      const hint = STAFF_MESSAGES[locale].schedule.builder.isPrivateHint;

      expect(hint, locale).toMatch(ANYONE[locale]);
      expect(hint, locale).toMatch(CAN_READ[locale]);
      expect(hint, locale).toMatch(CAN_BOOK[locale]);
    });

    it(`does not describe the link as a gate in ${locale}`, () => {
      expect(STAFF_MESSAGES[locale].schedule.builder.isPrivateHint, locale).not.toMatch(
        GATE[locale],
      );
    });

    it(`still says the departure is off the public schedule in ${locale}`, () => {
      // The listing filters are real and they are the reason the box exists;
      // stating the exposure must not talk a shop out of the feature.
      const hint = STAFF_MESSAGES[locale].schedule.builder.isPrivateHint;

      expect(hint, locale).toMatch(locale === "en-US" ? /public schedule/i : /calendario público/i);
    });
  }
});
