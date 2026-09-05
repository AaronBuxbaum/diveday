import { describe, expect, it } from "vitest";
import { LENS_NAME_MAX, lensSlugFrom, resolveLens } from "./trip-lenses";

/**
 * The slug is what a shared link carries, so these are the rules a diver's
 * bookmark depends on — and the one refusal that keeps a stale bookmark from
 * silently showing somebody else's word.
 */
describe("the shop's word, as a URL segment", () => {
  it("lowercases, drops punctuation, and joins the rest with single hyphens", () => {
    expect(lensSlugFrom("Small life & cameras")).toBe("small-life-cameras");
    expect(lensSlugFrom("After dark")).toBe("after-dark");
    expect(lensSlugFrom("First time back in a while")).toBe("first-time-back-in-a-while");
  });

  it("folds accents rather than dropping the letters under them", () => {
    expect(lensSlugFrom("Fotografía")).toBe("fotografia");
    expect(lensSlugFrom("Días tranquilos")).toBe("dias-tranquilos");
  });

  it("never leaves a leading or trailing hyphen", () => {
    expect(lensSlugFrom("  — Wrecks —  ")).toBe("wrecks");
    expect(lensSlugFrom("¡Buceo!")).toBe("buceo");
  });

  it("falls back to a nameable slug when nothing survives the fold", () => {
    // A row whose slug is the empty string is a row no URL can name.
    expect(lensSlugFrom("&&&")).toBe("lens");
  });

  it("caps the slug at the name's own limit, with no hyphen left hanging", () => {
    const slug = lensSlugFrom("a".repeat(60));
    expect(slug).toHaveLength(LENS_NAME_MAX);

    // The cut landing on a separator would leave "…-" behind.
    const cut = lensSlugFrom(`${"ab ".repeat(20)}`);
    expect(cut.endsWith("-")).toBe(false);
  });

  it("suffixes a collision rather than overwriting the word already using it", () => {
    expect(lensSlugFrom("Wrecks", ["wrecks"])).toBe("wrecks-2");
    expect(lensSlugFrom("Wrecks", ["wrecks", "wrecks-2"])).toBe("wrecks-3");
  });

  it("keeps a suffixed slug inside the cap", () => {
    const taken = [lensSlugFrom("z".repeat(60))];
    const second = lensSlugFrom("z".repeat(60), taken);
    expect(second).not.toBe(taken[0]);
    expect(second.length).toBeLessThanOrEqual(LENS_NAME_MAX);
  });
});

describe("what a ?lens= parameter resolves to", () => {
  const lenses = [
    { id: "a", slug: "easygoing-reef" },
    { id: "b", slug: "after-dark" },
  ];

  it("finds the lens whose slug the link names", () => {
    expect(resolveLens("after-dark", lenses)?.id).toBe("b");
  });

  it("answers null for an absent parameter", () => {
    expect(resolveLens(undefined, lenses)).toBeNull();
    expect(resolveLens("", lenses)).toBeNull();
  });

  it("answers null for a malformed one rather than throwing", () => {
    for (const bad of ["After Dark", "-after-dark", "after--dark", "after dark", "../etc"]) {
      expect(resolveLens(bad, lenses)).toBeNull();
    }
  });

  it("answers null for an unknown slug rather than falling back to the first lens", () => {
    // A stale bookmark from a shop that has since deleted the word must show
    // the whole board, never a narrowed list under a word the diver did not ask
    // for.
    expect(resolveLens("nope", lenses)).toBeNull();
  });

  it("answers null when the shop has written no vocabulary at all", () => {
    expect(resolveLens("after-dark", [])).toBeNull();
  });
});
