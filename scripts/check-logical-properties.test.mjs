import { describe, expect, it } from "vitest";

/**
 * The check's judgement, not its plumbing: which strings are a directional
 * utility and which merely look like one. The prose cases are the ones that
 * matter — the first version of this counted "right-hand" and "left-aligned"
 * out of comments and reported 26 violations that were sentences (issue #733).
 */
const PATTERN = (utility) =>
  new RegExp(
    `(?<![\\w-])-?(?:[a-z-]+:)*${utility}${utility.endsWith("-") ? "[\\w./\\[\\]%-]+" : ""}(?![\\w-])`,
    "g",
  );

const matches = (utility, text) => [...text.matchAll(PATTERN(utility))].map((m) => m[0]);

describe("what counts as a physical directional utility", () => {
  it("catches it with any variant stack, and negated", () => {
    expect(matches("ml-", 'className="ml-2 sm:ml-4 -ml-1 group-hover:ml-0"')).toEqual([
      "ml-2",
      "sm:ml-4",
      "-ml-1",
      "group-hover:ml-0",
    ]);
    expect(matches("left-", 'className="left-[31px] left-0"')).toEqual(["left-[31px]", "left-0"]);
  });

  /**
   * `border-r` must not eat `border-red-500`, which is the whole reason the
   * pattern is anchored on a boundary rather than a prefix — the same trap
   * `check-shop-word.mjs` documents for `tienda` inside `trastienda`.
   */
  it("does not match a colour that starts with the same letters", () => {
    expect(matches("border-r", 'className="border-red-500"')).toEqual([]);
    expect(matches("border-l", 'className="border-lime-400"')).toEqual([]);
  });

  it("does not match a word that merely contains one", () => {
    expect(matches("left-", "nothing left-over here")).toEqual(["left-over"]);
    // ...which is exactly why comments are stripped before any of this runs.
  });

  it("leaves the non-directional axis alone", () => {
    for (const utility of ["mt-", "mb-", "top-", "bottom-"]) {
      expect(
        matches(utility, 'className="mt-2 mb-4 top-0 bottom-1"').length,
        `${utility} is not directional and is not checked`,
      ).toBeGreaterThan(0);
    }
  });
});
