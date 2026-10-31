import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { readSchedulePage } from "./schedule-reads";

const ctx = fileScopedShopContext();

const VIEW = {
  lens: undefined,
  cursor: { after: undefined, before: undefined },
  listMonthBounds: null,
  hasSpaceFilter: false,
  tripTypeFilter: undefined,
} as const;

describe("readSchedulePage (in-memory PGlite)", () => {
  it("reads the board, its summaries and the storefront's shelves in one call", async () => {
    const { db, shop } = ctx;
    const reads = await readSchedulePage(db, shop, { ...VIEW, isEmbed: false, now: nowDate() });
    expect(reads.upcoming.length).toBeGreaterThan(0);
    expect(reads.range.first).not.toBeNull();
    expect(reads.everHadDeparture).toBe(true);
    // The cards' summaries are keyed by the listed departures' ids.
    for (const tripId of [...reads.diveSitesByTrip.keys(), ...reads.requirementsByTrip.keys()]) {
      expect(reads.upcoming.map((trip) => trip.id)).toContain(tripId);
    }
    expect(reads.diveSitesByTrip.size).toBeGreaterThan(0);
    expect(reads.activeLens).toBeNull();
  });

  it("reads no lenses, courses, fleet or rating inside the frame", async () => {
    const { db, shop } = ctx;
    const reads = await readSchedulePage(db, shop, { ...VIEW, isEmbed: true, now: nowDate() });
    expect(reads.lenses).toEqual([]);
    expect(reads.activeCourses).toEqual([]);
    expect(reads.boats).toEqual([]);
    expect(reads.reviewAggregate.count).toBe(0);
    expect(reads.upcoming.length).toBeGreaterThan(0);
  });

  it("resolves an unknown lens to the whole board", async () => {
    const { db, shop } = ctx;
    const reads = await readSchedulePage(db, shop, {
      ...VIEW,
      lens: "no-such-word",
      isEmbed: false,
      now: nowDate(),
    });
    expect(reads.activeLens).toBeNull();
    expect(reads.upcoming.length).toBeGreaterThan(0);
  });
});
