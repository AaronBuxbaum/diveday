import { describe, expect, it } from "vitest";
import { fill, pluralForm } from "./fill";
import { diverTranslator } from "./messages";
import { DIVER_LOCALES } from "./settings";
import { staffTranslator } from "./staff-messages";
import { daySpineSummaryText } from "./today-labels";

/**
 * **A count of one, read in every language we ship.**
 *
 * `pnpm check:icu-plurals` proves the *shape* — that no message interpolates a
 * count beside a word it does not inflect. This proves the *output*: the
 * sentences a shop actually reads, rendered at one, in both locales.
 *
 * The two are worth having separately. The check is a grep over bundles and
 * cannot know that four fragments get joined by a template at a call site; this
 * file composes them the way the component does, so a pair that exists but is
 * wired to the wrong count still fails here (issue #778).
 *
 * Why one: it is the value nothing in the tree ever rendered. The seeded demo
 * shop produces counts above one for almost everything, so every screenshot and
 * every e2e assertion had been taken in the state where a hard-coded plural is
 * correct — which is exactly how "1 bloqueados" survived on the shop home.
 */

/**
 * **The station's head count, read at one, in every language we ship.**
 *
 * This block used to compose the departure card's four-fragment boarding line
 * ("1 aboard · 1 clear to board · 1 blocked · 1 seat open"), which was the
 * sentence issue #778 was reported against: Spanish inflects the adjective as
 * well as the noun, so a boat with one diver in each state produced three
 * ungrammatical fragments at once. That card retired with the shop home's
 * recomposition into the day spine (ADR 20260827-clearwater-surface-language,
 * decision 4) and the four hand-joined fragments went with it — a station says
 * its head count as a figure and one plural sentence.
 *
 * The reason for testing it did not retire, so the same question is asked of
 * what replaced it: the spine's spot count, and the summary sentence above the
 * first station, both rendered at one.
 */
describe("the day spine's counts", () => {
  it.each(DIVER_LOCALES)("inflects the open-spots line in %s at one", (locale) => {
    const t = staffTranslator(locale);
    for (const count of [0, 1, 2, 11]) {
      const line = t("shopHome.spine.spotsOpen", { count });
      expect(line, `${locale} at ${count}`).not.toContain("{");
      expect(line, `${locale} at ${count}`).not.toContain("plural,");
    }
    // The singular and the plural are genuinely different sentences; asserting
    // only "no braces left" would pass against a pair identical by mistake.
    expect(t("shopHome.spine.spotsOpen", { count: 1 })).not.toBe(
      t("shopHome.spine.spotsOpen", { count: 2 }).replace("2", "1"),
    );
  });

  it.each(DIVER_LOCALES)("inflects the summary sentence in %s at one", (locale) => {
    const t = staffTranslator(locale);
    const line = daySpineSummaryText(t, { boats: 1, jobs: 1, nextDepartureTime: "7:00 AM" });
    expect(line, locale).not.toBeNull();
    expect(line ?? "", locale).not.toContain("{");
    expect(line ?? "", locale).not.toContain("plural,");
    // The after-the-fact half is a different sentence, not a shorter one.
    const away = daySpineSummaryText(t, { boats: 1, jobs: 1, nextDepartureTime: null });
    expect(away ?? "", locale).not.toContain("{");
    expect(away, locale).not.toBe(line);
  });
});

describe("counts a diver reads", () => {
  it.each(DIVER_LOCALES)("inflects the waiver progress line in %s", (locale) => {
    const t = diverTranslator(locale);
    const line = (total: number) =>
      fill(
        pluralForm(
          total,
          {
            one: t.raw("waiver.questionsAnsweredOne"),
            other: t.raw("waiver.questionsAnsweredOther"),
          },
          locale,
        ),
        { answered: 1, total },
      );
    expect(line(1)).not.toContain("{");
    // The singular and the plural are genuinely different sentences in Spanish
    // ("1 respondida" / "2 respondidas"); asserting only "no braces left" would
    // pass against a pair whose halves are identical by mistake.
    if (locale === "es-ES") expect(line(1)).not.toBe(line(2).replace("2", "1"));
  });
});
