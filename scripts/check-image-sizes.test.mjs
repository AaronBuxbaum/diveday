import { describe, expect, it } from "vitest";
import {
  ALL_SIZES,
  candidatePool,
  fetchedCandidate,
  mediaConditionHolds,
  resolveLength,
  resolveSizes,
} from "./image-sizes-lib.mjs";

/**
 * The arithmetic `pnpm check:image-sizes` decides with (issue #1350).
 *
 * It stands in for a browser the visual suite cannot use: `pnpm e2e:build` sets
 * `images.unoptimized`, so there is no srcset and `sizes` is not even in the
 * DOM. Everything below is therefore a claim about what a browser *would* do,
 * and if these are wrong the guard is confidently wrong about every declaration
 * in the app — so they are pinned against Next's own `getWidths` behaviour and
 * against the real measurements the registry was built from.
 */
describe("resolveLength", () => {
  it("reads the four length forms this app writes", () => {
    expect(resolveLength("180px", 1280)).toBe(180);
    expect(resolveLength("25vw", 1280)).toBe(320);
    expect(resolveLength("17rem", 1280)).toBe(272);
    expect(resolveLength("calc(100vw - 56px)", 390)).toBe(334);
  });

  it("throws on a form it does not understand rather than guessing", () => {
    // The failure mode this prevents is silent and total: a resolver that
    // returned 0 for an unknown form would report every image under-declared,
    // and one that returned Infinity would report none.
    expect(() => resolveLength("min(50vw, 300px)", 1280)).toThrow(/unsupported length/);
    expect(() => resolveLength("50%", 1280)).toThrow(/unsupported length/);
  });
});

describe("mediaConditionHolds", () => {
  it("is inclusive at both bounds, the way a media query is", () => {
    expect(mediaConditionHolds("(min-width: 640px)", 640)).toBe(true);
    expect(mediaConditionHolds("(min-width: 640px)", 639)).toBe(false);
    expect(mediaConditionHolds("(max-width: 640px)", 640)).toBe(true);
    expect(mediaConditionHolds("(max-width: 640px)", 641)).toBe(false);
  });
});

describe("resolveSizes", () => {
  it("takes the first condition that holds, not the narrowest", () => {
    const sizes = "(min-width: 1024px) 22rem, (min-width: 640px) 50vw, 100vw";
    expect(resolveSizes(sizes, 390)).toBe(390);
    expect(resolveSizes(sizes, 768)).toBe(384);
    expect(resolveSizes(sizes, 1280)).toBe(352);
  });

  it("handles a bare length with no condition at all", () => {
    expect(resolveSizes("48px", 1920)).toBe(48);
  });

  it("does not split a calc() on its own comma", () => {
    // The one function form in the tree is `calc(100vw - 56px)`, which has no
    // comma — but a future `min(…, …)` would break naive splitting, and this
    // records that the grammar is deliberately narrow rather than accidentally
    // sufficient.
    const sizes = "(max-width: 640px) calc(100vw - 56px), 576px";
    expect(resolveSizes(sizes, 390)).toBe(334);
    expect(resolveSizes(sizes, 1280)).toBe(576);
  });
});

describe("candidatePool", () => {
  it("drops the small files when the smallest vw is large, the way getWidths does", () => {
    // This is why an over-declared `vw` is worse than it looks: it does not
    // merely pick a bigger file, it removes the small ones from the srcset.
    expect(candidatePool("25vw")).not.toContain(128);
    expect(candidatePool("25vw")[0]).toBe(256);
    expect(candidatePool("100vw")[0]).toBe(640);
  });

  it("offers every size when the declaration names no vw at all", () => {
    expect(candidatePool("48px")).toEqual(ALL_SIZES);
  });
});

describe("fetchedCandidate", () => {
  it("takes the smallest file that covers the slot", () => {
    expect(fetchedCandidate("48px", 48, 1)).toBe(48);
    expect(fetchedCandidate("48px", 48, 2)).toBe(96);
    expect(fetchedCandidate("48px", 48, 3)).toBe(canonical(144));
  });

  /**
   * **The case the whole guard exists for**, from PR #1347: a 171px slot
   * declared as `25vw`. On a 1920px screen at DPR2 that fetched a 1080px file;
   * the fix declared `180px` and fetched 384px. Both numbers are asserted here
   * so a change to the pool arithmetic cannot quietly stop reproducing it.
   */
  it("reproduces the regression the visual suite could not see", () => {
    expect(fetchedCandidate("(min-width: 640px) 25vw, 50vw", 480, 2)).toBe(1080);
    expect(fetchedCandidate("180px", 180, 2)).toBe(384);
  });
});

/** The next size at or above a target, for readability in the assertion above. */
function canonical(target) {
  return ALL_SIZES.find((size) => size >= target) ?? ALL_SIZES[ALL_SIZES.length - 1];
}
