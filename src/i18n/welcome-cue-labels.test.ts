import { describe, expect, it } from "vitest";
import { catchUpSentences } from "./desk-event-labels";
import { staffTranslator } from "./staff-messages";
import { sayHelloSentences, welcomeCueText } from "./welcome-cue-labels";

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

  it("drops a group whose every diver has been erased", () => {
    // The names are joined live, so an erasure empties the group — and an empty
    // list is a sentence with a hole in it rather than a fact.
    expect(catchUpSentences(en, "en-US", [{ kind: "arrival", names: [] }])).toEqual([]);
  });
});
