import { describe, expect, it } from "vitest";

import { unboundedSizeFields } from "./check-rental-fit-caps.mjs";

/**
 * The guard's judgement, not its plumbing (issue #1794).
 *
 * Three ways it could go quietly useless, and each is a test below. It has to
 * fire on a boundary schema that caps a size with its own number — the shape
 * all three incidents had. It has to stay silent on the three things that are
 * not boundaries, because a guard that fires on `src/db/rental-fit.ts` or on a
 * JSX `maxLength` is one somebody deletes rather than argues with. And it must
 * not read an object literal that merely *carries* a size as a door that
 * accepts one, because every writer and every reader in the tree has one of
 * those and the guard would be noise on all of them.
 */

const WITH_LIMITS = `  finSize: z.string().trim().max(RENTAL_FIT_TEXT_LIMITS.size).optional(),`;
const WITH_A_NUMBER = `  finSize: z.string().trim().max(20).optional(),`;

describe("a size accepted from outside", () => {
  it("names a field capped with its own number", () => {
    const problems = unboundedSizeFields("src/app/shelf/[token]/actions.ts", WITH_A_NUMBER);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("finSize");
    expect(problems[0]).toContain("RENTAL_FIT_TEXT_LIMITS");
  });

  it("is quiet when the field reads the shared constant", () => {
    expect(unboundedSizeFields("src/app/shelf/[token]/actions.ts", WITH_LIMITS)).toEqual([]);
  });

  it("names every unbounded field, not just the first", () => {
    const source = [WITH_A_NUMBER, `  weightPreference: z.string().max(80),`].join("\n");

    expect(unboundedSizeFields("src/app/ready/[token]/actions.ts", source)).toHaveLength(2);
  });
});

describe("what is not a door", () => {
  /**
   * The one file that writes every one of these columns and is deliberately the
   * layer with no opinion about length. Teaching it a second cap would put the
   * number in two places, which is the thing #1728 fixed.
   */
  it("leaves the layer with no opinion about length alone", () => {
    expect(unboundedSizeFields("src/db/rental-fit.ts", WITH_A_NUMBER)).toEqual([]);
  });

  /**
   * An object literal carrying a size — every writer's `values()` and every
   * reader's projection has one. Anchoring on `z.` is what separates the two;
   * without it the guard fires on the whole tree and gets switched off.
   */
  it("does not read a carried value as an accepted one", () => {
    const source = [
      "  const values = {",
      "    finSize: input.finSize,",
      "    weightPreference: optional(input.weightPreference),",
      "  };",
    ].join("\n");

    expect(unboundedSizeFields("src/db/import.ts", source)).toEqual([]);
  });

  it("does not read a JSX maxLength as a bound", () => {
    const source = `            <input name="finSize" maxLength={RENTAL_FIT_TEXT_LIMITS.size} />`;

    expect(unboundedSizeFields("src/app/shelf/[token]/page.tsx", source)).toEqual([]);
  });
});

describe("the escape hatch", () => {
  it("takes a reason on the line itself", () => {
    const source = `  finSize: z.string().max(20), // diveday:allow-unbounded-size: mirrors a third party's field`;

    expect(unboundedSizeFields("src/app/x/actions.ts", source)).toEqual([]);
  });

  it("takes one on the line above, where the reason usually already is", () => {
    const source = [
      "  // diveday:allow-unbounded-size: mirrors a third party's field",
      WITH_A_NUMBER,
    ].join("\n");

    expect(unboundedSizeFields("src/app/x/actions.ts", source)).toEqual([]);
  });

  it("refuses a bare marker with no reason after it", () => {
    const source = [`  // diveday:allow-unbounded-size:`, WITH_A_NUMBER].join("\n");

    expect(unboundedSizeFields("src/app/x/actions.ts", source)).toHaveLength(1);
  });
});
