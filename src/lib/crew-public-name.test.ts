import { describe, expect, it } from "vitest";

import {
  CREW_PUBLIC_NAME_MAX,
  crewPublicNameToStore,
  defaultCrewPublicName,
} from "./crew-public-name";

/**
 * The rule that decides what a diver reads on a public page (issue #1351).
 *
 * Worth stating twice — here on the pure function and again in
 * `src/db/crew-public-consent.test.ts` against the real reader — because these
 * two answer different questions. This one is about the string; that one is
 * about whether the string is what actually publishes.
 */
describe("defaultCrewPublicName", () => {
  it("offers the first whitespace token, which is right far more often than not", () => {
    expect(defaultCrewPublicName("Marcus Webb")).toBe("Marcus");
    expect(defaultCrewPublicName("  Keiko   Tanaka  ")).toBe("Keiko");
  });

  it("keeps a one-word name whole", () => {
    expect(defaultCrewPublicName("Prince")).toBe("Prince");
  });

  /**
   * **A comma is the one place a record states its order**, so it is read
   * rather than guessed at — and the comma never travels with the name. Without
   * this, a one-tap save on a spreadsheet-imported row published `"Smith,"`:
   * the surname, with punctuation, on an indexed page.
   */
  it.each([
    ["Smith, John", "John"],
    ["Okonkwo, Talia", "Talia"],
    ["Tanaka,Keiko", "Keiko"],
    ["de Vries, Anna Maria", "Anna"],
  ])("reads %s as %s", (fullName, expected) => {
    expect(defaultCrewPublicName(fullName)).toBe(expected);
  });

  /**
   * **A space-separated name stays a guess, and the guess stays the first
   * token.** "Marcus Webb" and "Tanaka Keiko" are the same string to a parser,
   * and issue #1351's own proposal chose the first token so the ordinary case
   * is one tap. What makes that safe is not the guess getting better — it is
   * that it is now shown to the person under "Name divers see", in a box they
   * can correct, instead of being computed behind them at render time.
   */
  it("still cannot tell a surname-first record from a given-name-first one", () => {
    expect(defaultCrewPublicName("Tanaka Keiko")).toBe("Tanaka");
  });

  it("strips the invisibles that would reverse the text rendered after it", () => {
    // U+202E inside a published name reverses the role and languages that
    // follow it in the same row, because bidi resolves across the block.
    expect(defaultCrewPublicName("\u202EKeiko Tanaka")).toBe("Keiko");
    expect(defaultCrewPublicName("Kei\u200Bko Tanaka")).toBe("Keiko");
  });

  it("survives a record with no name in it", () => {
    expect(defaultCrewPublicName("")).toBe("");
    expect(defaultCrewPublicName("   ")).toBe("");
  });
});

describe("crewPublicNameToStore", () => {
  it("stores what the person typed", () => {
    expect(crewPublicNameToStore("Keiko", "Tanaka Keiko")).toBe("Keiko");
  });

  it("trims and collapses, because this is stored to be rendered", () => {
    expect(crewPublicNameToStore("  Mary   Jane  ", "Doe Mary Jane")).toBe("Mary Jane");
  });

  it("caps the one field that renders on an anonymous, indexed page", () => {
    const long = "a".repeat(CREW_PUBLIC_NAME_MAX + 25);
    expect(crewPublicNameToStore(long, "Someone Else")).toHaveLength(CREW_PUBLIC_NAME_MAX);
  });

  /**
   * An empty box is not a refusal. Somebody who ticks the consent and clears
   * the field has said yes, and the shop's own record is the best thing to
   * publish for them — the alternative is a consent that stores nothing and
   * renders one fewer person with no explanation.
   */
  it.each([undefined, null, "", "   "])("falls back to the default for %o", (input) => {
    expect(crewPublicNameToStore(input, "Marcus Webb")).toBe("Marcus");
  });

  /**
   * Null is the one answer `setCrewPublicConsent` turns into a refusal, and the
   * check constraint on `people` would reject it regardless. Unreachable
   * through the product — a staff member always has a name — and cheap to be
   * total about.
   */
  it("is null only when there is nothing at all to publish", () => {
    expect(crewPublicNameToStore("", "")).toBeNull();
    expect(crewPublicNameToStore("   ", "   ")).toBeNull();
  });
});
