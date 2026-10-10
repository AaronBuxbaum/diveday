import { describe, expect, it } from "vitest";
import { candidateBirthDate, noDiveDayNeedsSaying } from "./name-match-evidence";

/**
 * One rule, three doors (the walk-in panel, the trip's Add-diver section, and
 * `/divers/new`). What it is for is in `noDiveDayNeedsSaying`'s docblock: a
 * blank beside a dated sibling argues for the dated record, and the counter is
 * being asked to tell two people with one name apart.
 */
describe("noDiveDayNeedsSaying", () => {
  const match = (lastDiveDayAt: Date | null) => ({ lastDiveDayAt });
  const dived = match(new Date("2026-08-26T15:00:00Z"));

  it("stays quiet when no candidate has a dive day, because the line would say nothing", () => {
    expect(noDiveDayNeedsSaying([match(null), match(null)])).toBe(false);
  });

  it("speaks as soon as one candidate has a dive day", () => {
    expect(noDiveDayNeedsSaying([match(null), dived])).toBe(true);
  });

  it("is quiet for a list with no candidates at all", () => {
    // There is no prompt on screen to bias.
    expect(noDiveDayNeedsSaying([])).toBe(false);
  });
});

/**
 * H-79 (issue #1698). Null is the common case at this prompt, so what matters
 * most is that a candidate with no usable date prints nothing at all.
 */
describe("candidateBirthDate", () => {
  it("passes a stored calendar date through", () => {
    expect(candidateBirthDate({ dateOfBirth: "1984-03-09" })).toBe("1984-03-09");
  });

  it("prints nothing for a record nobody has dated", () => {
    expect(candidateBirthDate({ dateOfBirth: null })).toBeNull();
    expect(candidateBirthDate({ dateOfBirth: "" })).toBeNull();
  });

  it("prints nothing for a value that is not a real day", () => {
    expect(candidateBirthDate({ dateOfBirth: "1984-02-31" })).toBeNull();
    expect(candidateBirthDate({ dateOfBirth: "not a date" })).toBeNull();
  });
});
