import { describe, expect, it } from "vitest";
import { DIVER_LOCALES } from "./settings";
import { STAFF_MESSAGES } from "./staff-messages";

/**
 * **Every sentence about a crew clash states the fact — rostered on both —
 * and never an impossibility** (H-80, issue #1780).
 *
 * This guard used to require the opposite. Issue #1345 found the Move panel's
 * line stating a coincidence ("is already on {departure} at that time") in the
 * louder colour, and the fix was to say "cannot be on both"; issues #1695 and
 * #1779 carried that sentence to the Crew panel, the staffing week, the
 * roster's refusal and the boat manifest, and this file followed each one.
 *
 * H-80 then ruled on what a clash *is*. "Cannot be on both" is false of an
 * arrangement a shop can deliberately build — one captain across a course
 * group and a fun-dive group — and under "one hull, one departure at a time"
 * a shop models that as one departure with two groups. So every surface says
 * the roster fact: this person is **rostered on** the other departure at these
 * hours. That is true of every state a shop can reach, and it is still the
 * roster contradicting itself rather than a coincidence, because the word is
 * about the roster, not the clock.
 *
 * The class of failure this file catches is unchanged: one surface's words
 * drifting from the others'. A new reader of the clash belongs in this list.
 */
const ROSTERED = {
  "en-US": /rostered on/i,
  "es-ES": /figura en|en la tripulación de/i,
} as const satisfies Record<(typeof DIVER_LOCALES)[number], RegExp>;

const IMPOSSIBLE = {
  "en-US": /cannot|can’t|can't/i,
  "es-ES": /no puede/i,
} as const satisfies Record<(typeof DIVER_LOCALES)[number], RegExp>;

describe("crew-clash copy, on every surface that says it", () => {
  for (const locale of DIVER_LOCALES) {
    const messages = STAFF_MESSAGES[locale];
    const surfaces: readonly [string, string, readonly string[]][] = [
      // The Move panel: who, and which of the day's departures.
      ["the Move panel", messages.schedule.builder.impactCrewClash, ["{name}", "{departure}"]],
      // The departure's own Crew panel, in the person's row: the other boat.
      ["the departure's crew row", messages.trips.crew.clash, ["{departure}"]],
      // The staffing week's chip: no room for a name, the row is the person.
      ["the staffing week's chip", messages.staffing.week.crewClash, ["{departure}"]],
      // The roster's refusal: the panel knows who was picked, not which boat.
      ["the roster's refusal", messages.trips.crew.assignClash, ["{name}"]],
      // The boat manifest, which ends in an instruction for the captain.
      ["the boat manifest", messages.manifest.crewClashDetail, ["{departures}"]],
      // Today's queue, before the boat sails and after (issues #1776, #1814).
      ["Today, before it sails", messages.today.detail.crewClash, ["{names}", "{departure}"]],
      ["Today, once it sails", messages.today.detail.crewClashSailed, ["{names}", "{departure}"]],
    ];

    for (const [surface, sentence, placeholders] of surfaces) {
      it(`states the roster fact on ${surface} in ${locale}`, () => {
        for (const placeholder of placeholders) expect(sentence, locale).toContain(placeholder);
        expect(sentence, locale).toMatch(ROSTERED[locale]);
        expect(sentence, locale).not.toMatch(IMPOSSIBLE[locale]);
      });
    }

    it(`does not read like the blackout line in ${locale}`, () => {
      // The two sit one above the other and carry different weights on purpose:
      // a blackout is the crew member's own note and stays muted. If they ever
      // converge the split in `ScheduleBuilder.tsx` stops being legible to the
      // reader it was built for.
      const away = messages.schedule.builder.impactCrewAway;

      expect(away, locale).not.toMatch(ROSTERED[locale]);
    });
  }
});
