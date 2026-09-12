import { describe, expect, it } from "vitest";
import { DIVER_LOCALES } from "./settings";
import { STAFF_MESSAGES } from "./staff-messages";

/**
 * **Every sentence about a crew clash names the impossibility, not the
 * overlap.** A person on two overlapping departures is a state
 * `setTripCrew`/`changeTripCrew` both refuse outright, three writes that move
 * the boat manufacture anyway (`crewClashes`, src/db/trips-crew.ts), and the
 * manifest the coastguard reads prints twice.
 *
 * The guard was written for one line — `schedule.builder.impactCrewClash`, the
 * Move panel's (issue #1345). Until 2026-09-11 that sentence carried none of
 * it: "{name} is already on {departure} at that time." states a coincidence,
 * and at a glance it was the `impactCrewAway` line directly below wearing the
 * louder colour — the tone escalated in the component and the words never
 * followed.
 *
 * **Then issue #1695 added two more readers of the same fact** — the
 * departure's Crew panel and the staffing week — and this file still covered
 * only the first. It covers all three now (dive-domain-expert review,
 * 2026-09-12): the class of failure it exists to catch is a tone that moves
 * without its words, and a new surface is exactly where that happens.
 *
 * A reader told only that two things happen at once has been told to reconcile
 * them.
 */
const CANNOT = {
  "en-US": /cannot/i,
  "es-ES": /no puede/i,
} as const satisfies Record<(typeof DIVER_LOCALES)[number], RegExp>;

describe("crew-clash copy, on every surface that says it", () => {
  for (const locale of DIVER_LOCALES) {
    it(`names the impossibility rather than the coincidence in ${locale}`, () => {
      const sentence = STAFF_MESSAGES[locale].schedule.builder.impactCrewClash;

      // Both halves of the question the panel was opened to settle: who, and
      // which of the day's departures they are already rostered to.
      expect(sentence, locale).toContain("{name}");
      expect(sentence, locale).toContain("{departure}");
      expect(sentence, locale).toMatch(CANNOT[locale]);
    });

    /**
     * The departure's own Crew panel (issue #1695). It sits in the clashing
     * person's row, under their name, so it spends its words on the **other**
     * boat and names no name — which is why `{name}` is not asked for here.
     */
    it(`names the impossibility on the departure's crew row in ${locale}`, () => {
      const sentence = STAFF_MESSAGES[locale].trips.crew.clash;

      expect(sentence, locale).toContain("{departure}");
      expect(sentence, locale).toMatch(CANNOT[locale]);
    });

    /**
     * The staffing week's chip, which has a 135px cell and no room for a name
     * — the person is the row it is drawn in. The other departure is still
     * named, because which boat is the question a manager has the instant they
     * see it, and a count was built for #1203 and removed.
     */
    it(`names the impossibility on the staffing week's chip in ${locale}`, () => {
      const sentence = STAFF_MESSAGES[locale].staffing.week.crewClash;

      expect(sentence, locale).toContain("{departure}");
      expect(sentence, locale).toMatch(CANNOT[locale]);
    });

    /**
     * And the refusal a staffer meets trying to *create* one, which read as a
     * connection error until the dive-domain-expert review of 2026-09-12. It
     * names the person, because the panel knows who was picked and cannot know
     * which other boat — the write reports the impossibility, not its
     * counterpart.
     */
    it(`names the impossibility when the roster refuses one in ${locale}`, () => {
      const sentence = STAFF_MESSAGES[locale].trips.crew.assignClash;

      expect(sentence, locale).toContain("{name}");
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
