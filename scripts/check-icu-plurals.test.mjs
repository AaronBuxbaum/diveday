import { describe, expect, it } from "vitest";
import { findUninflectedCounts } from "./check-icu-plurals.mjs";

const flagged = (bundle, options) =>
  findUninflectedCounts(bundle, options).violations.map((violation) => violation.keyPath);

describe("a count beside a word it does not inflect", () => {
  it("is refused in English", () => {
    // The exact string the shop home rendered as "1 seats open".
    expect(flagged({ summary: "{open} seats open" })).toEqual(["summary"]);
  });

  it("is refused in Spanish, where the adjective inflects too", () => {
    expect(flagged({ summary: "{blocked} bloqueados" })).toEqual(["summary"]);
  });

  it("passes once it carries an ICU plural", () => {
    expect(flagged({ summary: "{open, plural, one {# seat open} other {# seats open}}" })).toEqual(
      [],
    );
  });

  /**
   * The noun agrees with whichever number stands nearest it. "3 of 8 divers
   * recorded" is about `total`, not `recorded` — a check that read the first
   * placeholder would ask the wrong number to be plural, and would pass a
   * message whose real count is one.
   */
  it("reads the second number in an X-of-Y phrase, not the first", () => {
    const found = findUninflectedCounts({ progress: "{recorded} of {total} divers recorded" });
    expect(found.violations[0]?.placeholder).toBe("total");
    expect(
      findUninflectedCounts({ progress: "{checkedIn} de {total} registrados" }).violations[0]
        ?.placeholder,
    ).toBe("total");
  });
});

describe("what is not a count", () => {
  /**
   * The false positives that made a naive "placeholder followed by a word
   * ending in s" rule unusable — all three are real strings in these bundles.
   */
  it.each([
    ["a shop name before a verb", { body: "{shopName} sails tomorrow." }],
    ["a competitor before a verb", { body: "{competitor} publishes no rate at all." }],
    ["a pre-formatted duration", { body: "Preséntate en el muelle {dock} antes." }],
  ])("ignores %s", (_label, bundle) => {
    expect(flagged(bundle)).toEqual([]);
  });

  it("ignores a unit abbreviation, which is not a noun to inflect", () => {
    expect(flagged({ depth: "{value} m" })).toEqual([]);
  });
});

describe("a hand-branched One/Other pair", () => {
  /**
   * These are the plural handling, spelled out instead of in ICU: the call site
   * picks the branch on the count, so `…Other`'s plural noun only ever renders
   * for a plural. Converting them is a separate cleanup and deliberately out of
   * this check's scope (issue #778).
   */
  it("passes when both halves exist", () => {
    expect(
      flagged({
        blockedWarningOne: "{count} diver cannot board yet.",
        blockedWarningOther: "{count} divers cannot board yet.",
      }),
    ).toEqual([]);
  });

  it("is refused when the singular half is missing, because then it is not a pair", () => {
    expect(flagged({ blockedWarningOther: "{count} divers cannot board yet." })).toEqual([
      "blockedWarningOther",
    ]);
  });
});

describe("the allowlist", () => {
  it("silences exactly the key it names, in exactly the file it names", () => {
    const bundle = {
      account: { common: { passwordErrors: { tooShort: "at least {min} characters" } } },
    };
    expect(flagged(bundle, { relative: "src/i18n/locales/en-US/diver.json" })).toEqual([]);
    // The same string anywhere else is still a finding — an allowlist entry is
    // a claim about one call site, not about a form of words.
    expect(flagged(bundle, { relative: "src/i18n/locales/en-US/staff/settings.json" })).toEqual([
      "account.common.passwordErrors.tooShort",
    ]);
  });
});
