import { describe, expect, it } from "vitest";
import { fullTripAlternatives, type OtherBoatsWhere, worthALookList } from "./other-boats";

const where: OtherBoatsWhere = {
  shopSlug: "blue-mantis",
  isEmbed: false,
  locale: "en-US",
  timeZone: "America/New_York",
};
const now = new Date("2026-07-21T13:30:00Z");

const trip = {
  id: "00000000-0000-4000-8000-000000000001",
  courseId: null,
  diveSite: { id: "site-a", difficultyLevel: "advanced" },
  startsAt: new Date("2026-07-25T12:00:00Z"),
  capacity: 10,
  booked: 10,
} as never;

/** `diveSiteId` names the site the departure's first chosen dive is at; null is no site yet. */
const candidate = (id: string, overrides: Record<string, unknown> = {}) => {
  const { diveSiteId = "site-a", ...rest } = overrides;
  return {
    id,
    title: `Boat ${id}`,
    courseId: null,
    diveSite: diveSiteId ? { id: diveSiteId, difficultyLevel: "advanced" } : null,
    startsAt: new Date("2026-07-26T12:00:00Z"),
    capacity: 10,
    booked: 2,
    ...rest,
  };
};

/** The board as the page reads it: each departure's own ask, and the read boat's as the ceiling. */
const board = (
  departures: ReturnType<typeof candidate>[],
  ceiling: Record<string, unknown> | null = null,
) => ({ departures: departures.map((row) => ({ requirement: null, ...row })), ceiling }) as never;

const openWater = {
  minimumCertificationLevel: "open_water",
  requiredSpecialties: [],
  requiresNitrox: false,
};

describe("fullTripAlternatives", () => {
  it("offers another departure to the same site, linked and worded in the shop's zone", () => {
    const rows = fullTripAlternatives(trip, board([candidate("b")]), where);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tripId: "b", reason: "same_site" });
    expect(rows[0]?.href).toBe("/s/blue-mantis/trips/b");
    // Worded as the header words a date, never assembled from parts.
    expect(rows[0]?.when).toMatch(/^Sun, Jul\s26$/);
  });

  it("keeps a framed reader inside the frame", () => {
    const rows = fullTripAlternatives(trip, board([candidate("b")]), {
      ...where,
      isEmbed: true,
    });
    expect(rows[0]?.href).toBe("/s/blue-mantis/trips/b?embed=1");
  });

  it("offers nothing that shares neither the course nor the site", () => {
    const rows = fullTripAlternatives(
      trip,
      board([candidate("c", { diveSiteId: "site-z" })]),
      where,
    );
    expect(rows).toEqual([]);
  });
});

describe("fullTripAlternatives on a repeating departure", () => {
  // Fourth UX review, item 31: this Saturday is full and next Saturday has
  // room. The run's next date leads, ahead of a same-site boat.
  const saturday = { ...(trip as object), seriesId: "run-sat" } as never;

  it("offers the run's next date first, as its own reason", () => {
    const rows = fullTripAlternatives(
      saturday,
      board([
        candidate("sun", { startsAt: new Date("2026-07-26T12:00:00Z") }),
        candidate("next-sat", {
          seriesId: "run-sat",
          diveSiteId: null,
          startsAt: new Date("2026-08-01T12:00:00Z"),
        }),
      ]),
      where,
    );
    expect(rows.map((row) => [row.tripId, row.reason])).toEqual([
      ["next-sat", "same_run"],
      ["sun", "same_site"],
    ]);
  });
});

describe("neither list offers a boat that asks more (fourth UX review, item 10)", () => {
  const deepWreck = {
    minimumCertificationLevel: "advanced_open_water",
    requiredSpecialties: [],
    requiresNitrox: true,
  };

  it("drops the Advanced nitrox wreck from a full Open Water boat's list", () => {
    const rows = fullTripAlternatives(
      trip,
      board([candidate("wreck", { requirement: deepWreck })], openWater),
      where,
    );
    expect(rows).toEqual([]);
  });

  it("drops it from an open boat's list too, though it is also a morning boat", () => {
    const open = { ...(trip as object), booked: 2, diveSite: null } as never;
    const morning = new Date("2026-07-26T12:00:00Z");
    const rows = worthALookList(
      open,
      board(
        [
          candidate("wreck", { diveSiteId: "site-w", startsAt: morning, requirement: deepWreck }),
          candidate("reef", { diveSiteId: "site-r", startsAt: morning, requirement: openWater }),
        ],
        openWater,
      ),
      { ...where, now },
    );
    expect(rows.map((row) => row.tripId)).toEqual(["reef"]);
  });
});

/**
 * Dive-domain review F3 of layer r4-1: a Discover Scuba session asks no card,
 * and neither does a reef whose sites the shop never rated, so the ladder
 * alone offered the first-timer a fun dive. A course that admits the
 * uncertified is only ever offered its own sessions.
 */
describe("a first-timer's course session is only offered its own course", () => {
  const dsd = {
    ...(trip as object),
    courseId: "dsd",
    course: { minimumCertificationLevel: null },
    diveSite: null,
  } as never;
  const morning = new Date("2026-07-26T12:00:00Z");

  it("drops the unrated reef from an open session's list and keeps the next session", () => {
    const open = { ...(dsd as object), booked: 2 } as never;
    const rows = worthALookList(
      open,
      board([
        candidate("reef", { diveSiteId: "site-r", startsAt: morning }),
        candidate("dsd-2", { courseId: "dsd", diveSiteId: null }),
      ]),
      { ...where, now },
    );
    expect(rows.map((row) => row.tripId)).toEqual(["dsd-2"]);
  });

  it("drops it from a full session's list too", () => {
    const rows = fullTripAlternatives(
      { ...(dsd as object), diveSite: { id: "site-a", difficultyLevel: "advanced" } } as never,
      board([candidate("reef"), candidate("dsd-2", { courseId: "dsd", diveSiteId: null })]),
      where,
    );
    expect(rows.map((row) => row.tripId)).toEqual(["dsd-2"]);
  });
});

describe("worthALookList", () => {
  it("never offers the departure the diver is reading", () => {
    const rows = worthALookList(trip, board([candidate((trip as { id: string }).id)]), {
      ...where,
      now,
    });
    expect(rows).toEqual([]);
  });

  it("words each row's day and time, and links it", () => {
    const rows = worthALookList(trip, board([candidate("b")]), { ...where, now });
    for (const row of rows) {
      expect(row.href).toBe(`/s/blue-mantis/trips/${row.tripId}`);
      expect(row.when).toMatch(/\d/);
    }
  });
});
