import { describe, expect, it } from "vitest";
import {
  PLANNING_NOTE_FRESH_DAYS,
  planningNoteDaysOld,
  planningNoteIsFresh,
} from "./dive-site-memory";

const now = new Date("2026-09-05T12:00:00.000Z");
const daysBefore = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

describe("the planning note's ninety days", () => {
  it("counts whole days since it was written", () => {
    expect(planningNoteDaysOld(now, now)).toBe(0);
    expect(planningNoteDaysOld(daysBefore(3), now)).toBe(3);
  });

  it("holds at exactly ninety and lets go on the ninety-first", () => {
    // The boundary is the rule, so it is the assertion: a note written on the
    // ninetieth day back is still on the site list, one day older is not.
    expect(planningNoteIsFresh(daysBefore(PLANNING_NOTE_FRESH_DAYS), now)).toBe(true);
    expect(planningNoteIsFresh(daysBefore(PLANNING_NOTE_FRESH_DAYS + 1), now)).toBe(false);
  });

  it("is never fresh with no stamp, because there is nothing to be fresh", () => {
    expect(planningNoteDaysOld(null, now)).toBeNull();
    expect(planningNoteIsFresh(null, now)).toBe(false);
  });
});
