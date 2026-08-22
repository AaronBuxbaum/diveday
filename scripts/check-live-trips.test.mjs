import { describe, expect, it } from "vitest";
import { findUnfilteredTripReads } from "./check-live-trips.mjs";

const lines = (source) => findUnfilteredTripReads(source).findings.map((finding) => finding.line);

describe("a read of trips", () => {
  it("passes when its own where clause filters deleted departures", () => {
    expect(
      lines(`
        db.select()
          .from(trips)
          .where(and(eq(trips.shopId, shopId), liveTrip()));
      `),
    ).toEqual([]);
  });

  it("is refused when nothing in it filters", () => {
    expect(
      lines(`
        db.select()
          .from(trips)
          .where(eq(trips.shopId, shopId));
      `),
    ).toEqual([3]);
  });

  it("passes when it says why it means deleted departures too", () => {
    expect(
      lines(`
        db.select()
          .from(trips)
          // diveday:allow-deleted-trips: the shop is taking everything it owns
          .where(eq(trips.shopId, shopId));
      `),
    ).toEqual([]);
  });

  it("is refused a join reaching through a child table that survives a delete", () => {
    expect(
      lines(`
        db.select()
          .from(tripDives)
          .innerJoin(trips, eq(trips.id, tripDives.tripId))
          .where(eq(trips.shopId, shopId));
      `),
    ).toEqual([4]);
  });
});

describe("two reads of trips sharing one array", () => {
  /**
   * The regression this rule exists for (issue #635). `listTripsReadiness`
   * shipped a site-requirement join with no `liveTrip()` twelve lines above a
   * course read that had one, inside the same `queryAll` array — and the old
   * fixed 60-line window counted the unfiltered one among the reads it called
   * filtered, because it found the *neighbour's* filter.
   */
  const neighbours = `
    await queryAll(db, [
      () =>
        db
          .select({ tripId: trips.id })
          .from(trips)
          .innerJoin(diveSites, eq(diveSites.id, trips.diveSiteId))
          .where(and(inArray(trips.id, tripIds), eq(trips.shopId, shopId))),
      () =>
        db
          .select({ id: trips.id })
          .from(trips)
          .leftJoin(courses, eq(courses.id, trips.courseId))
          .where(and(inArray(trips.id, tripIds), liveTrip())),
    ]);
  `;

  it("cannot be covered by its neighbour's filter", () => {
    expect(lines(neighbours)).toEqual([6]);
  });

  it("still counts both as guarded reads, so tightening lost no coverage", () => {
    expect(findUnfilteredTripReads(neighbours).guarded).toBe(2);
  });

  it("passes once each carries its own filter", () => {
    expect(lines(neighbours.replace("eq(trips.shopId, shopId))", "liveTrip())"))).toEqual([]);
  });
});
