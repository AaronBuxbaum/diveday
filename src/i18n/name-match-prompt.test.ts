import { describe, expect, it } from "vitest";
import { calculateReadiness } from "@/lib/readiness";
import { DIVER_LOCALES } from "./settings";
import { STAFF_MESSAGES } from "./staff-messages";

/**
 * `divers.page.confirmMatchesTitle` is the sentence that teaches a staffer what
 * a tap on a name-match candidate means. It is the only teaching on all three
 * doors that render the prompt — the walk-in panel, the trip's Add-diver
 * section, and `/divers/new`, which shows it with no booking in hand at all.
 *
 * Until 2026-09-11 it taught the opposite of what the tap does: "Picking one
 * gives this booking that diver's certifications and waiver." That stopped
 * being true the day the prompt's own tap started carrying `fromNameMatch`
 * (issue #1556). The flag makes the seat identity-unconfirmed, and such a
 * booking reads none of the matched person's evidence and spends none of their
 * package (`src/db/bookings.ts`), and fails closed at the boarding gate
 * (`src/lib/readiness.ts`). The cards arrive only after a separate confirm.
 *
 * So the prompt owes one thing in every locale: where it names the cards, it
 * names the confirmation that releases them. A sentence that names the cards
 * alone is a promise the code refuses to keep.
 */
const NEEDLES = {
  "en-US": { cards: /certifications and waiver/i, confirm: /confirm/i },
  "es-ES": { cards: /certificaciones y su exención/i, confirm: /confirm/i },
} as const satisfies Record<(typeof DIVER_LOCALES)[number], { cards: RegExp; confirm: RegExp }>;

describe("the counter's name-match prompt", () => {
  for (const locale of DIVER_LOCALES) {
    it(`names the confirmation beside the cards in ${locale}`, () => {
      const sentence = STAFF_MESSAGES[locale].divers.page.confirmMatchesTitle;

      // The prompt asks about the name the staffer just typed; without it the
      // question is about nobody.
      expect(sentence, locale).toContain("{name}");
      expect(sentence, locale).toMatch(NEEDLES[locale].cards);
      expect(sentence, locale).toMatch(NEEDLES[locale].confirm);
    });
  }

  it("describes a seat the boarding gate still refuses", () => {
    // The anchor for the sentence above: the day this blocker stops being
    // raised, the copy is wrong again and this test says so. The fuller case —
    // every other piece of evidence satisfied and still blocked — is in
    // `src/lib/readiness.test.ts`.
    const result = calculateReadiness({
      requirement: null,
      waiver: null,
      certifications: [],
      identityUnconfirmed: true,
      now: new Date("2026-09-11T12:00:00Z"),
    });

    expect(result.status).toBe("blocked");
    expect(result.blockers).toContainEqual(
      expect.objectContaining({ code: "identity_unconfirmed" }),
    );
  });
});

/**
 * `divers.page.confirmMatchesLastDive` is the evidence line under each
 * candidate — the one fact the counter's identity question turns on.
 *
 * It owes two things in every locale. **Scope**: the date is the last dive day
 * *this shop* can put behind the name (`findSimilarDivers` reads only this
 * shop's bookings and trips), so an unscoped "Last dived 3 Jan" invites a
 * staffer to rule out a diver who dives every weekend somewhere else — the
 * opposite of what the prompt is for. **Unit**: a date is a dive day, which for
 * a two-tank morning is two dives. Spanish said `Última inmersión` until
 * 2026-09-11, which states one dive on a day that was not, and reaches for the
 * one noun `src/i18n/locales/es-ES/README.md` reserves for a single tank in the
 * water; the product's settled unit is `día de buceo` (`dive day`).
 */
const LAST_DIVE_NEEDLES = {
  "en-US": { unit: /dive day/i, scope: /\bhere\b/i, wrongUnit: null },
  // No `\b` around `aquí`: JavaScript word boundaries are ASCII-only, so the
  // accented vowel never starts or ends one.
  "es-ES": { unit: /día de buceo/i, scope: /aquí/i, wrongUnit: /inmersi/i },
} as const satisfies Record<
  (typeof DIVER_LOCALES)[number],
  { unit: RegExp; scope: RegExp; wrongUnit: RegExp | null }
>;

describe("the candidate's last dive day", () => {
  for (const locale of DIVER_LOCALES) {
    it(`names the shop's own scope in the dive-day unit in ${locale}`, () => {
      const line = STAFF_MESSAGES[locale].divers.page.confirmMatchesLastDive;
      const needles = LAST_DIVE_NEEDLES[locale];

      // The date itself is formatted by the call site, in the shop's zone and
      // the reader's locale; the line may never spell one out.
      expect(line, locale).toContain("{date}");
      expect(line, locale).toMatch(needles.unit);
      expect(line, locale).toMatch(needles.scope);
      if (needles.wrongUnit) expect(line, locale).not.toMatch(needles.wrongUnit);
    });

    /**
     * `confirmMatchesNoDiveDay` is the same line with no date — rendered for a
     * candidate this shop has never had on a boat, whenever another candidate
     * on the same list has a date (`noDiveDayNeedsSaying`,
     * `src/lib/name-match-evidence.ts`). It owes the scope and the unit for the
     * same reason its dated twin does: the pair is read as one fact with two
     * values, and a blank that dropped "here" would invite a staffer to rule
     * out a diver who dives every weekend somewhere else.
     */
    it(`says the absent day in the same scope and unit in ${locale}`, () => {
      const line = STAFF_MESSAGES[locale].divers.page.confirmMatchesNoDiveDay;
      const needles = LAST_DIVE_NEEDLES[locale];

      // No date to name: this is the line for a record that has none.
      expect(line, locale).not.toContain("{date}");
      expect(line, locale).toMatch(needles.unit);
      expect(line, locale).toMatch(needles.scope);
      if (needles.wrongUnit) expect(line, locale).not.toMatch(needles.wrongUnit);
    });
  }
});
