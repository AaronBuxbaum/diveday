import { describe, expect, it } from "vitest";
import { WELCOME_HELLOS } from "@/lib/welcome-cue";
import { catchUpSentences } from "./desk-event-labels";
import { staffTranslator } from "./staff-messages";
import {
  sayHelloSentences,
  welcomeCueText,
  welcomeDockLine,
  welcomeDockLineUnchecked,
} from "./welcome-cue-labels";

const en = staffTranslator("en-US");
const es = staffTranslator("es-ES");

describe("welcomeCueText", () => {
  it("names both cue kinds in both locales", () => {
    for (const t of [en, es]) {
      expect(welcomeCueText(t, { kind: "first_trip" })).toBeTruthy();
      expect(welcomeCueText(t, { kind: "returning", years: 3 })).toBeTruthy();
    }
    expect(welcomeCueText(en, { kind: "first_trip" })).toBe("first time with us");
    expect(welcomeCueText(es, { kind: "first_trip" })).toBe("primera vez con nosotros");
  });

  it("agrees with the number of years, at one and at two, in both locales", () => {
    expect(welcomeCueText(en, { kind: "returning", years: 1 })).toBe("back after 1 year");
    expect(welcomeCueText(en, { kind: "returning", years: 2 })).toBe("back after 2 years");
    expect(welcomeCueText(es, { kind: "returning", years: 1 })).toBe("de vuelta tras 1 año");
    expect(welcomeCueText(es, { kind: "returning", years: 2 })).toBe("de vuelta tras 2 años");
  });

  it("continues the name above it rather than announcing itself", () => {
    // Lower case, no full stop, no "Welcome": it is a fragment under a name on
    // a manifest row, not a badge and not a sentence about a record.
    for (const text of [
      welcomeCueText(en, { kind: "first_trip" }),
      welcomeCueText(en, { kind: "returning", years: 4 }),
    ]) {
      expect(text[0]).toBe(text[0]?.toLowerCase());
      expect(text).not.toMatch(/\.$/);
    }
  });
});

describe("sayHelloSentences", () => {
  it("collapses the first-timers into one sentence and joins their names properly", () => {
    const sentences = sayHelloSentences(en, "en-US", [
      { name: "Ben Okafor", cue: { kind: "first_trip" } },
      { name: "Lina Costa", cue: { kind: "first_trip" } },
    ]);
    expect(sentences).toHaveLength(1);
    // `Intl.ListFormat`, never a hand-rolled ", " — which would put an English
    // "and" into the Spanish sentence.
    expect(sentences[0]).toContain("Ben Okafor and Lina Costa");
  });

  it("joins the names in the reader's own language", () => {
    const sentences = sayHelloSentences(es, "es-ES", [
      { name: "Ben Okafor", cue: { kind: "first_trip" } },
      { name: "Lina Costa", cue: { kind: "first_trip" } },
    ]);
    expect(sentences[0]).toContain("Ben Okafor y Lina Costa");
  });

  it("gives each returning diver their own sentence, with their own number", () => {
    const sentences = sayHelloSentences(en, "en-US", [
      { name: "Ada Lindqvist", cue: { kind: "returning", years: 3 } },
      { name: "Hugo Marsh", cue: { kind: "returning", years: 1 } },
    ]);
    expect(sentences).toEqual([
      "Ada Lindqvist is back after 3 years.",
      "Hugo Marsh is back after 1 year.",
    ]);
  });

  it("says nothing when nobody consented", () => {
    expect(sayHelloSentences(en, "en-US", [])).toEqual([]);
  });
});

describe("catchUpSentences", () => {
  it("agrees with the number of divers in a group, in both locales", () => {
    const one = catchUpSentences(en, "en-US", [{ kind: "arrival", names: ["Ada Lindqvist"] }]);
    const two = catchUpSentences(en, "en-US", [
      { kind: "arrival", names: ["Ada Lindqvist", "Ben Okafor"] },
    ]);
    expect(one).toEqual(["Ada Lindqvist has checked in."]);
    expect(two).toEqual(["Ada Lindqvist and Ben Okafor have checked in."]);
    expect(catchUpSentences(es, "es-ES", [{ kind: "arrival", names: ["Ada Lindqvist"] }])).toEqual([
      "Ada Lindqvist se registró.",
    ]);
  });

  it("says the two trip-wide facts plainly, with no names", () => {
    expect(
      catchUpSentences(en, "en-US", [
        { kind: "meeting_point", names: [] },
        { kind: "plan_changed", names: [] },
      ]),
    ).toEqual(["The meeting point moved.", "The dive plan changed."]);
  });

  it("says a seat removed after the desk turned its diver away was turned away", () => {
    expect(
      catchUpSentences(en, "en-US", [{ kind: "seat_turned_away", names: ["Ada Lindqvist"] }]),
    ).toEqual(["Ada Lindqvist was turned away at the desk."]);
    expect(
      catchUpSentences(es, "es-ES", [
        { kind: "seat_turned_away", names: ["Ada Lindqvist", "Ben Okafor"] },
      ]),
    ).toEqual(["En el mostrador no se les permitió embarcar a Ada Lindqvist y Ben Okafor."]);
  });

  it("drops a group whose every diver has been erased", () => {
    // The names are joined live, so an erasure empties the group — and an empty
    // list is a sentence with a hole in it rather than a fact.
    expect(catchUpSentences(en, "en-US", [{ kind: "arrival", names: [] }])).toEqual([]);
  });
});

describe("welcomeDockLine", () => {
  const card = {
    level: "open_water" as const,
    levelSelfDeclared: false,
    noCertificationDeclared: false,
    nitrox: false,
    nitroxSelfDeclared: false,
    verifiedLevel: "open_water" as const,
  };

  it("names the diver by first name and the card they hold, in both locales", () => {
    expect(welcomeDockLine(en, { personName: "Priya Sharma", certification: card })).toBe(
      "Say hello to Priya: Open Water.",
    );
    expect(welcomeDockLine(es, { personName: "Priya Sharma", certification: card })).toMatch(
      /^Saluda a Priya: .+\.$/,
    );
  });

  it("ends with the diver's own choice when there is one, in both locales (#2425)", () => {
    expect(
      welcomeDockLine(en, { personName: "Priya Sharma", certification: card, hello: "nervous" }),
    ).toBe("Say hello to Priya: Open Water. A little nervous.");
    expect(
      welcomeDockLine(en, {
        personName: "Priya Sharma",
        certification: null,
        hello: "first_ocean_dive",
      }),
    ).toBe("Say hello to Priya. First ocean dive.");
    for (const hello of WELCOME_HELLOS) {
      const spoken = welcomeDockLine(es, {
        personName: "Priya Sharma",
        certification: card,
        hello,
      });
      expect(spoken).toMatch(/^Saluda a Priya: .+\. .+\.$/);
      expect(spoken).not.toContain("shared.welcomeCue");
    }
  });

  it("says nothing extra without a choice, and has no way to take a note", () => {
    expect(welcomeDockLine(en, { personName: "Priya Sharma", certification: card })).toBe(
      "Say hello to Priya: Open Water.",
    );
    expect(
      welcomeDockLine(en, { personName: "Priya Sharma", certification: card, hello: null }),
    ).toBe("Say hello to Priya: Open Water.");
    // Free text cannot arrive: the line's parameters are a name, a card and a code.
    expect(welcomeDockLine.length).toBe(2);
  });

  it("says when the level is only the diver's word", () => {
    const claimed = { ...card, levelSelfDeclared: true, verifiedLevel: null };
    expect(welcomeDockLine(en, { personName: "Priya Sharma", certification: claimed })).toBe(
      "Say hello to Priya: says Open Water.",
    );
    expect(welcomeDockLineUnchecked(claimed)).toBe(true);
  });

  /**
   * **A card a staffer typed and nobody has verified is not a verified card**
   * (dive-domain review of the demo layer). It carries no self-declared stamp,
   * so the summary phrase reads it as a plain "Open Water", and the dock line
   * did too: the crew greeted a pending card as a checked one.
   */
  it("says 'says Open Water' for a pending card a staffer typed, in both locales", () => {
    const pending = { ...card, levelSelfDeclared: false, verifiedLevel: null };
    expect(welcomeDockLine(en, { personName: "Priya Sharma", certification: pending })).toBe(
      "Say hello to Priya: says Open Water.",
    );
    expect(welcomeDockLine(es, { personName: "Priya Sharma", certification: pending })).toBe(
      "Saluda a Priya: dice Open Water.",
    );
    expect(welcomeDockLineUnchecked(pending)).toBe(true);
    expect(welcomeDockLineUnchecked(card)).toBe(false);
  });

  it("greets with the verified level when a higher card is still pending", () => {
    const mixed = {
      ...card,
      level: "advanced_open_water" as const,
      verifiedLevel: "open_water" as const,
    };
    expect(welcomeDockLine(en, { personName: "Priya Sharma", certification: mixed })).toBe(
      "Say hello to Priya: Open Water.",
    );
    expect(welcomeDockLineUnchecked(mixed)).toBe(false);
  });

  it("never names nitrox: a greeting is not a fill clearance", () => {
    const withNitrox = { ...card, nitrox: true };
    const line = welcomeDockLine(en, { personName: "Priya Sharma", certification: withNitrox });
    expect(line).toBe("Say hello to Priya: Open Water.");
    const claimedNitrox = { ...card, nitrox: true, nitroxSelfDeclared: true };
    expect(
      welcomeDockLine(es, {
        personName: "Priya Sharma",
        certification: claimedNitrox,
      }),
    ).not.toMatch(/nitrox/i);
  });

  it("says 'not certified yet' for a diver who said so, which is the safety-relevant answer", () => {
    const line = welcomeDockLine(en, {
      personName: "Priya Sharma",
      certification: { ...card, level: null, verifiedLevel: null, noCertificationDeclared: true },
    });
    expect(line).toMatch(/^Say hello to Priya: .*not certified/i);
    expect(
      welcomeDockLineUnchecked({
        ...card,
        level: null,
        verifiedLevel: null,
        noCertificationDeclared: true,
      }),
    ).toBe(true);
  });

  it("greets without a card when the shop holds none and the diver said nothing", () => {
    expect(welcomeDockLine(en, { personName: "Priya Sharma", certification: null })).toBe(
      "Say hello to Priya.",
    );
  });

  it("falls back to the whole name when there is no first name to take", () => {
    expect(welcomeDockLine(en, { personName: "Cher", certification: null })).toBe(
      "Say hello to Cher.",
    );
  });
});
