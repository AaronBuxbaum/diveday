import { describe, expect, it } from "vitest";

import { EXEMPT_FILE, findCopy, looksLikeCopy } from "./check-copy.mjs";

/**
 * `scripts/copy-baseline.json` is empty, so this check is a **full gate** over
 * `src/app` and `src/components`: any hard-coded copy anywhere under those
 * roots fails it. That makes the failure mode of a too-broad exclusion a green
 * run — nothing to notice, and the repository's main defence against
 * untranslated copy quietly off.
 *
 * So every rule is pinned in both directions: the syntax it must excuse, and
 * whether a real sentence survives it. Three of those answers came back wrong,
 * and are recorded here as measurements rather than quietly fixed — issue #1130
 * asked for the heuristic under test *as it stands*, on the grounds that a rule
 * change with a test beside it is a different and easier commit. Each is marked
 * MEASURED, NOT DESIRED below and filed as its own issue (#1258).
 */

const texts = (source, isTsx = true) => findCopy(source, { isTsx }).map((hit) => hit.text);

describe("looksLikeCopy — prose still reports", () => {
  it("takes an ordinary sentence", () => {
    expect(looksLikeCopy("Ready to dive?")).toBe(true);
    expect(looksLikeCopy("Book now")).toBe(true);
    expect(looksLikeCopy("No answer needs physician sign-off")).toBe(true);
  });

  it("takes a sentence whose punctuation ends a clause", () => {
    // The property-access rule is suppressed by sentence punctuation, which is
    // what keeps "Sorry. Something broke." from reading as `foo.bar`.
    expect(looksLikeCopy("Everyone is home. Close the day out.")).toBe(true);
  });

  // Pinned as it stands, and it is a deliberate under-report: the
  // bare-identifier rule cannot tell the button label "Go" from the variable
  // `go`, and this scanner is tuned to miss rather than to block unrelated
  // work. A single word with no space never reports.
  it("misses a single word with no space, identifier or label alike", () => {
    expect(looksLikeCopy("Go")).toBe(false);
    expect(looksLikeCopy("shopSlug")).toBe(false);
    expect(looksLikeCopy("Ready")).toBe(false);
  });
});

describe("looksLikeCopy — syntax the >…< window straddles does not", () => {
  it("excuses operators and template holes", () => {
    expect(looksLikeCopy("a && b")).toBe(false);
    expect(looksLikeCopy("first || second")).toBe(false);
    expect(looksLikeCopy("value => other")).toBe(false);
    expect(looksLikeCopy("left === right")).toBe(false);
    expect(looksLikeCopy("left !== right")).toBe(false);
    expect(looksLikeCopy("trip?.name")).toBe(false);
    expect(looksLikeCopy(`total $\{amount} due`)).toBe(false);
  });

  it("excuses a ternary", () => {
    expect(looksLikeCopy("ready ? yes : no")).toBe(false);
  });

  it("excuses property access and a call", () => {
    expect(looksLikeCopy("trip.waiverComplete")).toBe(false);
    expect(looksLikeCopy("formatDate()")).toBe(false);
  });

  it("excuses a bare identifier, a slug, a path and an entity", () => {
    expect(looksLikeCopy("shopSlug")).toBe(false);
    expect(looksLikeCopy("blue-mantis")).toBe(false);
    expect(looksLikeCopy("./relative/path")).toBe(false);
    expect(looksLikeCopy("#anchor")).toBe(false);
    expect(looksLikeCopy("@handle")).toBe(false);
    expect(looksLikeCopy("&nbsp;")).toBe(false);
  });

  it("excuses a `name: Type` annotation left by a generic", () => {
    expect(looksLikeCopy("shopId: ShopId")).toBe(false);
  });

  it("excuses anything with a statement separator", () => {
    expect(looksLikeCopy("const a = 1; return a")).toBe(false);
  });

  it("refuses a value with no run of two letters", () => {
    expect(looksLikeCopy("1")).toBe(false);
    expect(looksLikeCopy("42%")).toBe(false);
    expect(looksLikeCopy("a")).toBe(false);
  });
});

/**
 * The pair added on 2026-08-28. Each was right about the false positive it
 * fixed; neither was checked against the copy it might excuse, which is the
 * direction that turns this gate off silently.
 */
describe("looksLikeCopy — the two 2026-08-28 exclusions, both directions", () => {
  it("excuses the type union that caused it", () => {
    // `=> void | Promise<void>` leaves this behind five times in one file of
    // server-action props.
    expect(looksLikeCopy("void | Promise")).toBe(false);
  });

  it("excuses the comparison tail that caused it", () => {
    // `photos.length >= maxPhotos ? (` arrives with the `=` as the window's
    // first character.
    expect(looksLikeCopy("= maxPhotos ? (")).toBe(false);
  });

  // MEASURED, NOT DESIRED. Both rules are wider than the false positives they
  // were added for, and each swallows real copy. Pinned here as it stands, per
  // issue #1130's instruction to get the heuristic under test before changing
  // it; the hole is filed as #1258. If a later change narrows either
  // rule, these two expectations flip to `true` and that is the change working.
  it("also excuses a sentence carrying a spaced pipe — the union rule is too wide", () => {
    expect(looksLikeCopy("Book a trip | Blue Mantis Divers")).toBe(false);
    expect(looksLikeCopy("Certified | Nitrox | Rescue")).toBe(false);
  });

  it("also excuses a sentence starting with an equals sign — the comparison rule is too wide", () => {
    expect(looksLikeCopy("= a sentence a person actually reads")).toBe(false);
  });
});

describe("findCopy — JSX", () => {
  it("finds a text node", () => {
    expect(texts("<p>Ready to dive?</p>")).toEqual(["Ready to dive?"]);
  });

  it("finds copy wearing a braced-string disguise", () => {
    expect(texts('<p> {"Ready to dive?"} </p>')).toContain("Ready to dive?");
  });

  it("finds a copy attribute in either quote style", () => {
    expect(texts('<input placeholder="Search divers" />')).toEqual(['placeholder="Search divers"']);
    expect(texts("<img alt='A reef at dawn' />")).toEqual(['alt="A reef at dawn"']);
  });

  it("leaves className, href and test ids alone", () => {
    expect(texts('<a href="/s/blue-mantis" className="text-lg font-semibold">{name}</a>')).toEqual(
      [],
    );
  });

  it("never reads prose out of a comment", () => {
    expect(texts("// Ready to dive? is the heading we removed\nconst a = 1;")).toEqual([]);
    expect(texts("/* Ready to dive? */\nconst a = 1;")).toEqual([]);
  });

  it("finds nothing in a .ts file's JSX-shaped text", () => {
    // Only `.tsx` carries JSX; the `.ts` walk is the narrower label-map one.
    expect(texts("<p>Ready to dive?</p>", false)).toEqual([]);
  });
});

describe("findCopy — label maps in .ts", () => {
  it("finds a prose-named property", () => {
    expect(texts('const M = { message: "That seat is taken" };', false)).toEqual([
      'message: "That seat is taken"',
    ]);
  });

  it("leaves a class map alone", () => {
    // `variant`/`tone`/`size` keys are deliberately outside copyProperties.
    expect(texts('const M = { variant: "rounded-2xl border border-border" };', false)).toEqual([]);
  });
});

describe("findCopy — exemptions", () => {
  it("honours an exemption on the line", () => {
    expect(texts("<p>Ready to dive?</p> {/* i18n-exempt: brand name */}")).toEqual([]);
  });

  it("honours an exemption on the line above", () => {
    expect(texts("{/* i18n-exempt: brand name */}\n<p>Ready to dive?</p>")).toEqual([]);
  });

  // MEASURED, NOT DESIRED. `\s*\S` is meant to demand a reason, and in the
  // `//` form it does. In the JSX-comment form the comment's own closing `*/`
  // supplies the non-space character, so a reasonless exemption is honoured.
  // Filed with the two rules above as #1258, rather than fixed here.
  it("honours a reasonless JSX exemption, because `*/` satisfies the reason check", () => {
    expect(texts("{/* i18n-exempt: */}\n<p>Ready to dive?</p>")).toEqual([]);
    // The `//` form behaves as intended.
    expect(texts("// i18n-exempt:\n<p>Ready to dive?</p>")).toEqual(["Ready to dive?"]);
  });

  it("refuses an exemption that is not in a comment", () => {
    // An escape hatch a plain string can trigger is a hole, not a hatch.
    expect(EXEMPT_FILE.test("<p>Write i18n-exempt-file: reason to skip</p>")).toBe(false);
    expect(EXEMPT_FILE.test("// i18n-exempt-file: generated template copy")).toBe(true);
  });
});
