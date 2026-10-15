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
  diveSiteId: "site-a",
  diveSite: { difficultyLevel: "advanced" },
  startsAt: new Date("2026-07-25T12:00:00Z"),
  capacity: 10,
  booked: 10,
} as never;

const candidate = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Boat ${id}`,
  courseId: null,
  diveSiteId: "site-a",
  diveSite: { difficultyLevel: "advanced" },
  startsAt: new Date("2026-07-26T12:00:00Z"),
  capacity: 10,
  booked: 2,
  ...overrides,
});

describe("fullTripAlternatives", () => {
  it("offers another departure to the same site, linked and worded in the shop's zone", () => {
    const rows = fullTripAlternatives(trip, [candidate("b")] as never, where);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tripId: "b", reason: "same_site" });
    expect(rows[0]?.href).toBe("/s/blue-mantis/trips/b");
    // Worded as the header words a date, never assembled from parts.
    expect(rows[0]?.when).toMatch(/^Sun, Jul\s26$/);
  });

  it("keeps a framed reader inside the frame", () => {
    const rows = fullTripAlternatives(trip, [candidate("b")] as never, {
      ...where,
      isEmbed: true,
    });
    expect(rows[0]?.href).toBe("/s/blue-mantis/trips/b?embed=1");
  });

  it("offers nothing that shares neither the course nor the site", () => {
    const rows = fullTripAlternatives(
      trip,
      [candidate("c", { diveSiteId: "site-z" })] as never,
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
      [
        candidate("sun", { startsAt: new Date("2026-07-26T12:00:00Z") }),
        candidate("next-sat", {
          seriesId: "run-sat",
          diveSiteId: null,
          startsAt: new Date("2026-08-01T12:00:00Z"),
        }),
      ] as never,
      where,
    );
    expect(rows.map((row) => [row.tripId, row.reason])).toEqual([
      ["next-sat", "same_run"],
      ["sun", "same_site"],
    ]);
  });
});

describe("worthALookList", () => {
  it("never offers the departure the diver is reading", () => {
    const rows = worthALookList(trip, [candidate((trip as { id: string }).id)] as never, {
      ...where,
      now,
    });
    expect(rows).toEqual([]);
  });

  it("words each row's day and time, and links it", () => {
    const rows = worthALookList(trip, [candidate("b")] as never, { ...where, now });
    for (const row of rows) {
      expect(row.href).toBe(`/s/blue-mantis/trips/${row.tripId}`);
      expect(row.when).toMatch(/\d/);
    }
  });
});
