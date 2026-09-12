import { describe, expect, it } from "vitest";
import { DIVER_LOCALES } from "./settings";
import { STAFF_MESSAGES } from "./staff-messages";

/**
 * `schedule.builder.impactCrewClash` is the one line on the Move panel that
 * wears the blocked line's weight and is announced (issue #1345): a person on
 * two overlapping departures is a state `setTripCrew`/`changeTripCrew` both
 * refuse outright, `moveTrip` manufactures, and the manifest the coastguard
 * reads prints twice.
 *
 * Until 2026-09-11 the sentence carried none of that. "{name} is already on
 * {departure} at that time." states a coincidence, and at a glance it is the
 * `impactCrewAway` line directly below it wearing a louder colour — the tone
 * escalated in the component and the words never followed.
 *
 * So the line owes one thing in every locale: it names the impossibility, not
 * the overlap. One person cannot crew two hulls, and a reader who is told only
 * that two things happen at once has been told to reconcile them.
 */
const CANNOT = {
  "en-US": /cannot/i,
  "es-ES": /no puede/i,
} as const satisfies Record<(typeof DIVER_LOCALES)[number], RegExp>;

describe("the Move panel's crew clash", () => {
  for (const locale of DIVER_LOCALES) {
    it(`names the impossibility rather than the coincidence in ${locale}`, () => {
      const sentence = STAFF_MESSAGES[locale].schedule.builder.impactCrewClash;

      // Both halves of the question the panel was opened to settle: who, and
      // which of the day's departures they are already rostered to.
      expect(sentence, locale).toContain("{name}");
      expect(sentence, locale).toContain("{departure}");
      expect(sentence, locale).toMatch(CANNOT[locale]);
    });

    it(`does not read like the blackout line in ${locale}`, () => {
      // The two sit one above the other and carry different weights on purpose:
      // a blackout is the crew member's own note and stays muted. If they ever
      // converge the split in `ScheduleBuilder.tsx` stops being legible to the
      // reader it was built for.
      const away = STAFF_MESSAGES[locale].schedule.builder.impactCrewAway;

      expect(away, locale).not.toMatch(CANNOT[locale]);
    });
  }
});
