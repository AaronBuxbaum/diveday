import { describe, expect, it } from "vitest";
import { parseDiveSiteDifficulty } from "./dive-site-difficulty";

/**
 * `dive_sites.difficulty` was free text until 2026-08-13, and immutable
 * published template versions still carry whatever was written there. So the
 * parser is not only a form guard — it is the reader for two generations of
 * stored data, and the property that matters is that it never invents a
 * reading it was not given.
 */
describe("parseDiveSiteDifficulty", () => {
  it("takes the three codes", () => {
    expect(parseDiveSiteDifficulty("beginner")).toBe("beginner");
    expect(parseDiveSiteDifficulty("intermediate")).toBe("intermediate");
    expect(parseDiveSiteDifficulty("advanced")).toBe("advanced");
  });

  it("reads the legacy free text every shop and template actually stored", () => {
    // The column held whatever a staffer typed, and the migration's backfill
    // matches on exactly this shape. If these stopped parsing, a published
    // template would silently import with no difficulty at all.
    expect(parseDiveSiteDifficulty("Advanced")).toBe("advanced");
    expect(parseDiveSiteDifficulty("  Beginner  ")).toBe("beginner");
  });

  it("reads anything else as nothing said, never as a guess", () => {
    // The briefing renders "crew-led" for null, which is the honest answer for
    // a word the app cannot translate. Mapping "calm" onto beginner would be
    // the app deciding what a shop meant.
    for (const value of ["calm", "expert", "all levels", "", "   ", null, undefined, 3, {}]) {
      expect(parseDiveSiteDifficulty(value)).toBeNull();
    }
  });
});
