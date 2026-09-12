import { describe, expect, it } from "vitest";
import { noDiveDayNeedsSaying } from "./name-match-evidence";

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
