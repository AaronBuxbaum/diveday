import { describe, expect, it } from "vitest";
import { fill, pluralForm } from "./fill";
import { diverTranslator } from "./messages";
import { DIVER_LOCALES } from "./settings";
import { staffTranslator } from "./staff-messages";

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

/** The departure card's boarding line, composed the way `DepartureBoard` does. */
function boardingSummary(locale: string, counts: Record<string, number>): string {
  const t = staffTranslator(locale);
  const fragment = (count: number, name: string) =>
    fill(
      pluralForm(
        count,
        {
          one: t.raw(`shared.today.departureBoard.boarding${name}One` as never),
          other: t.raw(`shared.today.departureBoard.boarding${name}Other` as never),
        },
        locale,
      ),
      { count },
    );
  return fill(t.raw("shared.today.departureBoard.boardingSummary"), {
    aboard: fragment(counts.aboard ?? 0, "Aboard"),
    ready: fragment(counts.ready ?? 0, "Ready"),
    blocked: fragment(counts.blocked ?? 0, "Blocked"),
    open: fragment(counts.open ?? 0, "Open"),
  });
}

describe("the departure card's boarding line", () => {
  it("reads as Spanish at one, in all four counts", () => {
    // The line issue #778 was reported against. Every one of the four was
    // wrong: Spanish inflects the adjective as well as the noun, so a boat with
    // one diver in each state produced three ungrammatical fragments at once.
    expect(boardingSummary("es-ES", { aboard: 1, ready: 1, blocked: 1, open: 1 })).toBe(
      "1 a bordo · 1 listo para embarcar · 1 bloqueado · 1 plaza libre",
    );
  });

  it("reads as English at one", () => {
    expect(boardingSummary("en-US", { aboard: 1, ready: 1, blocked: 1, open: 1 })).toBe(
      "1 aboard · 1 clear to board · 1 blocked · 1 seat open",
    );
  });

  it.each(DIVER_LOCALES)("leaves no placeholder unresolved in %s at any count", (locale) => {
    for (const count of [0, 1, 2, 11]) {
      const line = boardingSummary(locale, {
        aboard: count,
        ready: count,
        blocked: count,
        open: count,
      });
      expect(line, `${locale} at ${count}`).not.toContain("{");
      expect(line, `${locale} at ${count}`).not.toContain("plural,");
    }
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
