import { describe, expect, it } from "vitest";

import { similarDepartures } from "./similar-departures";

/**
 * The restraint is the feature (issue #1166, D06). A full boat already links
 * to the whole schedule, so a list of *vaguely* similar departures is that
 * page with extra steps — and D06's boundary says relevant or nothing.
 */

const FULL = { tripId: "full", courseId: null, diveSiteId: "site-a" };

function candidate(over: Partial<Parameters<typeof similarDepartures>[0]["candidates"][number]>) {
  return {
    id: "t1",
    title: "Two-Tank Reef",
    startsAt: new Date("2030-08-05T13:00:00Z"),
    courseId: null,
    diveSiteId: null,
    ...over,
  };
}

describe("similarDepartures", () => {
  it("says nothing when nothing is actually similar", () => {
    // The case that matters most: a shop running four unrelated boats next
    // week offers none of them here, because "also a departure" is not a
    // reason and the page already links to the board.
    expect(
      similarDepartures({
        full: FULL,
        candidates: [candidate({ id: "t1" }), candidate({ id: "t2", diveSiteId: "site-b" })],
      }),
    ).toEqual([]);
  });

  it("never treats two absences as a match", () => {
    // A fun dive with no site set is not similar to every other fun dive with
    // no site set. Null is "names no site", not a value that can agree.
    expect(
      similarDepartures({
        full: { tripId: "full", courseId: null, diveSiteId: null },
        candidates: [candidate({ id: "t1" })],
      }),
    ).toEqual([]);
  });

  it("offers the same site, and says that is why", () => {
    const [first] = similarDepartures({
      full: FULL,
      candidates: [candidate({ id: "t1", diveSiteId: "site-a" })],
    });
    expect(first).toEqual({
      tripId: "t1",
      title: "Two-Tank Reef",
      startsAt: new Date("2030-08-05T13:00:00Z"),
      reason: "same_site",
    });
  });

  /**
   * A course session is a commitment to a syllabus; a site is a preference. A
   * diver who wanted Open Water on the 14th wants Open Water, so a session of
   * it outranks any boat that merely visits the same reef — and a departure
   * that is both is reported as the course, which is the stronger claim.
   */
  it("puts the same course ahead of the same site, and calls a both a course", () => {
    const result = similarDepartures({
      full: { tripId: "full", courseId: "ow", diveSiteId: "site-a" },
      candidates: [
        candidate({
          id: "site-only",
          diveSiteId: "site-a",
          startsAt: new Date("2030-08-02T13:00:00Z"),
        }),
        candidate({ id: "both", courseId: "ow", diveSiteId: "site-a" }),
      ],
    });
    expect(result.map((row) => [row.tripId, row.reason])).toEqual([
      ["both", "same_course"],
      ["site-only", "same_site"],
    ]);
  });

  it("puts the sooner of two like departures first, and stops at two", () => {
    const result = similarDepartures({
      full: FULL,
      candidates: [
        candidate({
          id: "third",
          diveSiteId: "site-a",
          startsAt: new Date("2030-08-09T13:00:00Z"),
        }),
        candidate({
          id: "first",
          diveSiteId: "site-a",
          startsAt: new Date("2030-08-05T13:00:00Z"),
        }),
        candidate({
          id: "second",
          diveSiteId: "site-a",
          startsAt: new Date("2030-08-07T13:00:00Z"),
        }),
      ],
    });
    expect(result.map((row) => row.tripId)).toEqual(["first", "second"]);
  });

  it("is never an alternative to itself", () => {
    // The full departure is in the candidate list whenever it still has a
    // cancelled booking's seat back, and offering a diver the boat they just
    // failed to get onto would be the surface arguing with itself.
    expect(
      similarDepartures({
        full: FULL,
        candidates: [candidate({ id: "full", diveSiteId: "site-a" })],
      }),
    ).toEqual([]);
  });

  /**
   * Fourth UX review, item 31: the weekly Saturday boat fills while next
   * Saturday has room, and the matcher ignored the run, so the full page
   * offered nothing. The run's next date with a seat is the first answer.
   */
  describe("a repeating departure", () => {
    const RUN_FULL = {
      tripId: "sat-17",
      courseId: null,
      diveSiteId: "site-a",
      seriesId: "run-1",
      startsAt: new Date("2030-08-17T13:00:00Z"),
    };

    it("offers the run's next date with room first, as its own reason", () => {
      const rows = similarDepartures({
        full: RUN_FULL,
        candidates: [
          candidate({
            id: "same-site",
            diveSiteId: "site-a",
            startsAt: new Date("2030-08-18T13:00:00Z"),
          }),
          candidate({
            id: "sat-31",
            seriesId: "run-1",
            startsAt: new Date("2030-08-31T13:00:00Z"),
          }),
          candidate({
            id: "sat-24",
            seriesId: "run-1",
            startsAt: new Date("2030-08-24T13:00:00Z"),
          }),
        ],
      });
      expect(rows.map((row) => [row.tripId, row.reason])).toEqual([
        ["sat-24", "same_run"],
        ["same-site", "same_site"],
      ]);
    });

    it("never calls an earlier date of the run its next one, nor another run's", () => {
      const rows = similarDepartures({
        full: RUN_FULL,
        candidates: [
          candidate({
            id: "sat-10",
            seriesId: "run-1",
            startsAt: new Date("2030-08-10T13:00:00Z"),
          }),
          candidate({
            id: "other-run",
            seriesId: "run-2",
            startsAt: new Date("2030-08-20T13:00:00Z"),
          }),
        ],
      });
      expect(rows).toEqual([]);
    });

    it("lets a later date of the run still match by its site", () => {
      const rows = similarDepartures({
        full: RUN_FULL,
        candidates: [
          candidate({
            id: "sat-24",
            seriesId: "run-1",
            diveSiteId: "site-a",
            startsAt: new Date("2030-08-24T13:00:00Z"),
          }),
          candidate({
            id: "sat-31",
            seriesId: "run-1",
            diveSiteId: "site-a",
            startsAt: new Date("2030-08-31T13:00:00Z"),
          }),
        ],
      });
      expect(rows.map((row) => [row.tripId, row.reason])).toEqual([
        ["sat-24", "same_run"],
        ["sat-31", "same_site"],
      ]);
    });
  });
});
