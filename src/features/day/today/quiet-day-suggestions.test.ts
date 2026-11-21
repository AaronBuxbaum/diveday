import { describe, expect, it } from "vitest";
import { QUIET_DAY_SUGGESTION_LIMIT, quietDaySuggestions } from "./quiet-day-suggestions";

const NOW = new Date("2026-07-20T14:00:00Z");
const hoursFromNow = (hours: number) => new Date(NOW.getTime() + hours * 60 * 60 * 1000);

/**
 * **The quiet day's suggestions** (issue #4257): the boats just past the
 * queue's one-week horizon that already have someone to clear. A quiet day is
 * the time to start on them, and a day with nothing real to suggest says
 * nothing more than the pinned pair of `spineIsQuiet` in `today.test.ts`.
 */
describe("quietDaySuggestions", () => {
  const trip = (id: string, days: number) => ({
    id,
    title: `Trip ${id}`,
    startsAt: hoursFromNow(days * 24),
  });

  it("suggests nothing when every later diver is clear", () => {
    expect(quietDaySuggestions([trip("t1", 9)], new Map([["t1", 0]]))).toEqual([]);
    expect(quietDaySuggestions([trip("t1", 9)], new Map())).toEqual([]);
    expect(quietDaySuggestions([], new Map())).toEqual([]);
  });

  it("names a later boat with blocked divers, soonest first, and stops at the limit", () => {
    const suggestions = quietDaySuggestions(
      [trip("late", 13), trip("clear", 8), trip("soon", 9), trip("mid", 11)],
      new Map([
        ["late", 1],
        ["clear", 0],
        ["soon", 2],
        ["mid", 3],
      ]),
    );
    expect(QUIET_DAY_SUGGESTION_LIMIT).toBe(2);
    expect(suggestions).toEqual([
      { tripId: "soon", title: "Trip soon", startsAt: hoursFromNow(9 * 24), blocked: 2 },
      { tripId: "mid", title: "Trip mid", startsAt: hoursFromNow(11 * 24), blocked: 3 },
    ]);
  });
});
