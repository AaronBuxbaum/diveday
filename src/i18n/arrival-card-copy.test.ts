import { describe, expect, it } from "vitest";
import { DIVER_MESSAGES } from "./messages";
import { DIVER_LOCALES } from "./settings";

/**
 * **The arrival card's QR line names the people at the counter, not the boat's
 * crew** (dive-domain-expert review, 2026-09-12).
 *
 * The code is scanned at the shop's kiosk, in the lobby, before anyone is near
 * the water — `src/app/check-in/[token]` is the counter's door. "The crew will
 * find you" sends a diver looking for the boat for a job the desk does, and a
 * divemaster reading it knows within one word whether the software was written
 * by somebody who has stood at a counter. The Spanish had the same fault twice
 * over: `el equipo` is the crew *and* the gear this same bundle rents.
 *
 * The word for the boat's people is still `tripulante`/`tripulación`
 * (`src/i18n/locales/es-ES/README.md`) — it just does not belong on this line.
 */
const COUNTER = {
  "en-US": /\bstaff\b/i,
  "es-ES": /\bpersonal\b/i,
} as const satisfies Record<(typeof DIVER_LOCALES)[number], RegExp>;

const BOAT = {
  "en-US": /\bcrew\b/i,
  "es-ES": /\b(tripulaci[oó]n|tripulantes?|equipo)\b/i,
} as const satisfies Record<(typeof DIVER_LOCALES)[number], RegExp>;

describe("the arrival card's scan line", () => {
  for (const locale of DIVER_LOCALES) {
    it(`sends the diver to the counter's people in ${locale}`, () => {
      const body = DIVER_MESSAGES[locale].trip.arrivalCodeBody;

      expect(body, locale).toMatch(COUNTER[locale]);
      expect(body, locale).not.toMatch(BOAT[locale]);
    });
  }
});
