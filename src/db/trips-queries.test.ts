import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { bookings } from "./schema";
import {
  createTrip,
  pagedUpcomingTripsWithCounts,
  SCHEDULE_PAGE_SIZE,
  upcomingScheduleRange,
  upcomingScheduleStats,
  upcomingTripsWithCounts,
} from "./trips";

describe("demo seed + schedule queries (in-memory PGlite)", () => {
  it("returns upcoming trips ordered by start with correct booked counts", async () => {
    const { db, shop } = await seededShopContext();

    const upcoming = await upcomingTripsWithCounts(db, shop.id);
    expect(upcoming).toHaveLength(42);

    const starts = upcoming.map((t) => t.startsAt.getTime());
    expect(starts).toEqual([...starts].sort((a, b) => a - b));

    const bySlugishTitle = Object.fromEntries(upcoming.map((t) => [t.title, t.booked]));
    expect(bySlugishTitle["Two-Tank Reef — Molasses & French"]).toBe(9);
    expect(bySlugishTitle["Wreck Trip — Spiegel Grove"]).toBe(10);
    expect(bySlugishTitle["Two-Tank Reef — Christ of the Abyss"]).toBe(0);
    expect(
      upcoming.find((trip) => trip.title === "Discover Scuba — Pool & Reef")?.course?.title,
    ).toBe("Discover Scuba Diving");
    // The seeded Open Water session is what the public course page books into.
    expect(
      upcoming.find((trip) => trip.title === "Open Water Diver — three-day course")?.course?.title,
    ).toBe("Open Water Diver");
  });

  it("frees the spot when a booking is cancelled", async () => {
    const { db, shop } = await seededShopContext();

    const before = await upcomingTripsWithCounts(db, shop.id);
    const wreck = before.find((t) => t.title === "Wreck Trip — Spiegel Grove");
    if (!wreck) throw new Error("wreck trip missing");
    expect(wreck.booked).toBe(wreck.capacity); // seeded sold out

    const [first] = await db.select().from(bookings).limit(1);
    if (!first) throw new Error("no bookings seeded");
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, first.id));

    const after = await upcomingTripsWithCounts(db, shop.id);
    const total = (rows: typeof after) => rows.reduce((sum, t) => sum + t.booked, 0);
    expect(total(after)).toBe(total(before) - 1);
  });
});

describe("paged schedule queries", () => {
  it("pages the board with a keyset cursor, in departure order, without gaps", async () => {
    const { db, shop } = await seededShopContext();
    const all = await upcomingTripsWithCounts(db, shop.id);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let hops = 0; hops < 20; hops++) {
      const page = await pagedUpcomingTripsWithCounts(db, shop.id, { cursor, limit: 5 });
      expect(page.trips.length).toBeLessThanOrEqual(5);
      seen.push(...page.trips.map((t) => t.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(all.map((t) => t.id));

    // The extended roster is well past SCHEDULE_PAGE_SIZE, so the default
    // page truncates to the first page's worth, in departure order.
    const onePage = await pagedUpcomingTripsWithCounts(db, shop.id);
    expect(onePage.nextCursor).not.toBeNull();
    expect(onePage.trips.map((t) => t.id)).toEqual(
      all.slice(0, SCHEDULE_PAGE_SIZE).map((t) => t.id),
    );
  });

  it("filters to fun dives or course sessions on request", async () => {
    const { db, shop } = await seededShopContext();
    const all = await upcomingTripsWithCounts(db, shop.id);
    expect(all.some((t) => t.course !== null)).toBe(true);
    expect(all.some((t) => t.course === null)).toBe(true);

    // A large limit — this test verifies filtering correctness across the
    // whole seed, not pagination, so neither call should be page-size-clipped.
    const funDives = await pagedUpcomingTripsWithCounts(db, shop.id, {
      tripType: "fun_dive",
      limit: 1000,
    });
    expect(funDives.trips.length).toBeGreaterThan(0);
    expect(funDives.trips.every((t) => t.course === null)).toBe(true);

    const courseSessions = await pagedUpcomingTripsWithCounts(db, shop.id, {
      tripType: "course",
      limit: 1000,
    });
    expect(courseSessions.trips.length).toBeGreaterThan(0);
    expect(courseSessions.trips.every((t) => t.course !== null)).toBe(true);

    expect(funDives.trips.length + courseSessions.trips.length).toBe(all.length);
  });

  it("filters to trips with an open seat on request", async () => {
    const { db, shop } = await seededShopContext();
    const all = await upcomingTripsWithCounts(db, shop.id);
    expect(all.some((t) => t.booked >= t.capacity)).toBe(true); // the seed has a full trip
    expect(all.some((t) => t.booked < t.capacity)).toBe(true);

    const withSpace = await pagedUpcomingTripsWithCounts(db, shop.id, {
      hasSpace: true,
      limit: 200,
    });
    expect(withSpace.trips.length).toBeGreaterThan(0);
    expect(withSpace.trips.length).toBeLessThan(all.length);
    expect(withSpace.trips.every((t) => t.booked < t.capacity)).toBe(true);
  });

  it("computes board-wide stats that match the full list", async () => {
    const { db, shop } = await seededShopContext();
    const all = await upcomingTripsWithCounts(db, shop.id);
    const stats = await upcomingScheduleStats(db, shop.id);

    expect(stats.departures).toBe(all.length);
    expect(stats.booked).toBe(all.reduce((sum, t) => sum + t.booked, 0));
    expect(stats.openSeats).toBe(
      all.reduce((sum, t) => sum + Math.max(0, t.capacity - t.booked), 0),
    );
    expect(stats.atCapacity).toBe(all.filter((t) => t.booked >= t.capacity).length);

    const range = await upcomingScheduleRange(db, shop.id);
    expect(range.first?.getTime()).toBe(all[0]?.startsAt.getTime());
    expect(range.last?.getTime()).toBe(all.at(-1)?.startsAt.getTime());
  });

  it("bounds the page to an explicit month, so the list can follow the calendar", async () => {
    const { db, shop } = await seededShopContext();
    const now = new Date("2030-07-01T00:00:00.000Z");

    const august = await createTrip(db, {
      shopId: shop.id,
      title: "August trip",
      startsAt: new Date("2030-08-15T12:00:00Z"),
      endsAt: new Date("2030-08-15T16:00:00Z"),
      capacity: 4,
    });
    const september = await createTrip(db, {
      shopId: shop.id,
      title: "September trip",
      startsAt: new Date("2030-09-15T12:00:00Z"),
      endsAt: new Date("2030-09-15T16:00:00Z"),
      capacity: 4,
    });
    if (!august || !september) throw new Error("trip not created");

    const augustPage = await pagedUpcomingTripsWithCounts(db, shop.id, {
      now,
      monthStart: new Date("2030-08-01T00:00:00Z"),
      monthEnd: new Date("2030-09-01T00:00:00Z"),
    });
    expect(augustPage.trips.map((t) => t.id)).toEqual([august.id]);
    expect(augustPage.nextCursor).toBeNull();

    const septemberPage = await pagedUpcomingTripsWithCounts(db, shop.id, {
      now,
      monthStart: new Date("2030-09-01T00:00:00Z"),
      monthEnd: new Date("2030-10-01T00:00:00Z"),
    });
    expect(septemberPage.trips.map((t) => t.id)).toEqual([september.id]);

    // A month bound that starts before `now` still respects `now` as the floor.
    const augustFromLaterNow = await pagedUpcomingTripsWithCounts(db, shop.id, {
      now: new Date("2030-08-16T00:00:00Z"),
      monthStart: new Date("2030-08-01T00:00:00Z"),
      monthEnd: new Date("2030-09-01T00:00:00Z"),
    });
    expect(augustFromLaterNow.trips).toHaveLength(0);
  });
});
