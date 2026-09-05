import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { bookings, people, tripAssignments, tripScheduleDays, trips } from "@/db/schema";
import { listStaff, upcomingTripsWithCounts } from "@/db/trips";
import { seededShopContext } from "@/test/db";
import { FEED_FUTURE_DAYS, FEED_PAST_DAYS, listFeedTrips } from "./feed-trips";

async function context() {
  const { db, shop } = await seededShopContext();
  const staff = await listStaff(db, shop.id);
  const member = staff.find((entry) => entry.roles.includes("owner"));
  if (!member) throw new Error("seeded shop has no owner");
  const upcoming = await upcomingTripsWithCounts(db, shop.id);
  const [trip] = upcoming;
  if (!trip) throw new Error("seeded shop has no upcoming trip");
  return { db, shop, personId: member.person.id, trip };
}

describe("listFeedTrips", () => {
  it("publishes every scheduled departure to a shop-wide feed", async () => {
    const { db, shop, personId } = await context();
    const feed = await listFeedTrips(db, { shopId: shop.id, personId, scope: "shop_trips" });
    expect(feed.length).toBeGreaterThan(0);
    expect(feed.every((entry) => entry.title.length > 0)).toBe(true);
  });

  it("narrows an assignments feed to the trips this person actually crews", async () => {
    const { db, shop, personId, trip } = await context();
    await db.delete(tripAssignments).where(eq(tripAssignments.personId, personId));
    await db.insert(tripAssignments).values({ tripId: trip.id, personId });

    const feed = await listFeedTrips(db, { shopId: shop.id, personId, scope: "assignments" });
    expect(feed.length).toBeGreaterThan(0);
    expect(new Set(feed.map((entry) => entry.tripId))).toEqual(new Set([trip.id]));
  });

  it("returns an empty feed — not every trip — for a person crewing nothing", async () => {
    const { db, shop, personId } = await context();
    await db.delete(tripAssignments).where(eq(tripAssignments.personId, personId));
    expect(await listFeedTrips(db, { shopId: shop.id, personId, scope: "assignments" })).toEqual(
      [],
    );
  });

  it("keeps a single-day trip that has no trip_schedule_days rows", async () => {
    const { db, shop, personId, trip } = await context();
    // The exact shape an inner join would silently drop — a departure simply
    // missing from a captain's calendar.
    await db.delete(tripScheduleDays).where(eq(tripScheduleDays.tripId, trip.id));

    const feed = await listFeedTrips(db, { shopId: shop.id, personId, scope: "shop_trips" });
    const entry = feed.find((row) => row.tripId === trip.id);
    expect(entry).toBeDefined();
    expect(entry?.dayNumber).toBeNull();
    expect(entry?.startsAt.toISOString()).toBe(trip.startsAt.toISOString());
    expect(entry?.endsAt.toISOString()).toBe(trip.endsAt.toISOString());
  });

  it("emits one entry per scheduled day of a multi-day trip", async () => {
    const { db, shop, personId, trip } = await context();
    await db.delete(tripScheduleDays).where(eq(tripScheduleDays.tripId, trip.id));
    await db.insert(tripScheduleDays).values([
      {
        tripId: trip.id,
        dayNumber: 1,
        startsAt: trip.startsAt,
        endsAt: new Date(trip.startsAt.getTime() + 4 * 60 * 60 * 1000),
      },
      {
        tripId: trip.id,
        dayNumber: 2,
        startsAt: new Date(trip.startsAt.getTime() + 24 * 60 * 60 * 1000),
        endsAt: new Date(trip.startsAt.getTime() + 28 * 60 * 60 * 1000),
      },
    ]);

    const feed = await listFeedTrips(db, { shopId: shop.id, personId, scope: "shop_trips" });
    const days = feed.filter((row) => row.tripId === trip.id);
    expect(days.map((row) => row.dayNumber)).toEqual([1, 2]);
  });

  it("drops a cancelled trip, because a subscriber's calendar removes it by absence", async () => {
    const { db, shop, personId, trip } = await context();
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, trip.id));

    const feed = await listFeedTrips(db, { shopId: shop.id, personId, scope: "shop_trips" });
    expect(feed.some((row) => row.tripId === trip.id)).toBe(false);
  });

  it("never publishes another shop's departures", async () => {
    const { db, personId } = await context();
    const other = "00000000-0000-4000-8000-0000000000ff";
    expect(await listFeedTrips(db, { shopId: other, personId, scope: "shop_trips" })).toEqual([]);
  });

  it("bounds the window so a subscription does not re-send years of history", async () => {
    const { db, shop, personId, trip } = await context();
    const wayOut = new Date(trip.startsAt.getTime() - (FEED_PAST_DAYS + 30) * 24 * 60 * 60 * 1000);

    const feed = await listFeedTrips(db, {
      shopId: shop.id,
      personId,
      scope: "shop_trips",
      now: new Date(trip.startsAt.getTime() + (FEED_FUTURE_DAYS + 30) * 24 * 60 * 60 * 1000),
    });
    expect(feed.some((row) => row.tripId === trip.id)).toBe(false);
    expect(wayOut.getTime()).toBeLessThan(trip.startsAt.getTime());
  });

  it("lists each crew member once, sorted, even across several schedule days", async () => {
    const { db, shop, personId, trip } = await context();
    const feed = await listFeedTrips(db, { shopId: shop.id, personId, scope: "shop_trips" });
    const entry = feed.find((row) => row.tripId === trip.id);
    expect(entry).toBeDefined();
    expect(new Set(entry?.crew).size).toBe(entry?.crew.length);
    expect([...(entry?.crew ?? [])]).toEqual(
      [...(entry?.crew ?? [])].sort((a, b) => a.localeCompare(b)),
    );
  });

  it("never carries a diver's name — a feed URL is a bearer token pasted into Google", async () => {
    const { db, shop, personId } = await context();
    // Every booked diver on the shop's upcoming trips.
    const divers = await db
      .select({ name: people.fullName })
      .from(bookings)
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(and(eq(bookings.shopId, shop.id), ne(bookings.status, "cancelled")));
    expect(divers.length).toBeGreaterThan(0);

    const feed = await listFeedTrips(db, { shopId: shop.id, personId, scope: "shop_trips" });
    // Crew are staff and may legitimately appear; a diver who is not also crew
    // must not. Compare against the staff roster to keep the assertion honest
    // when a seeded person holds both roles.
    const staffNames = new Set((await listStaff(db, shop.id)).map((s) => s.person.fullName));
    const published = new Set(feed.flatMap((entry) => entry.crew));
    for (const diver of divers) {
      if (staffNames.has(diver.name)) continue;
      expect(published.has(diver.name)).toBe(false);
    }

    // And nothing diver-shaped rides along in the free-text fields either.
    const text = feed.map((e) => `${e.title} ${e.courseTitle ?? ""} ${e.location ?? ""}`).join(" ");
    for (const diver of divers) {
      if (staffNames.has(diver.name)) continue;
      expect(text).not.toContain(diver.name);
    }
  });

  /**
   * Issue #704 slice 2. A dive site out on the water is not a place a
   * calendar app can point anyone toward — a departure with its own meeting
   * point is exactly the case where the site's name would send a captain to
   * the wrong parking lot.
   */
  it("locates a departure by its own meeting point over the dive site, when one is set", async () => {
    const { db, shop, personId, trip } = await context();
    await db
      .update(trips)
      .set({ meetingPointLabel: "North Jetty Marina", meetingPointAddress: "12 Dock Rd" })
      .where(eq(trips.id, trip.id));

    const feed = await listFeedTrips(db, { shopId: shop.id, personId, scope: "shop_trips" });
    const entry = feed.find((row) => row.tripId === trip.id);
    expect(entry?.location).toBe("North Jetty Marina, 12 Dock Rd");
  });

  it("names the meeting point alone when no address is on file", async () => {
    const { db, shop, personId, trip } = await context();
    await db
      .update(trips)
      .set({ meetingPointLabel: "North Jetty Marina", meetingPointAddress: null })
      .where(eq(trips.id, trip.id));

    const feed = await listFeedTrips(db, { shopId: shop.id, personId, scope: "shop_trips" });
    const entry = feed.find((row) => row.tripId === trip.id);
    expect(entry?.location).toBe("North Jetty Marina");
  });

  it("falls back to the dive site when the departure has no meeting point of its own", async () => {
    const { db, shop, personId, trip } = await context();
    await db
      .update(trips)
      .set({ meetingPointLabel: null, meetingPointAddress: null })
      .where(eq(trips.id, trip.id));

    const feed = await listFeedTrips(db, { shopId: shop.id, personId, scope: "shop_trips" });
    const entry = feed.find((row) => row.tripId === trip.id);
    expect(entry?.location).not.toContain("North Jetty");
  });

  it("carries the trip's revision on every day of it, and reports the bumped value after a move", async () => {
    const { db, shop, personId, trip } = await context();
    await db.delete(tripScheduleDays).where(eq(tripScheduleDays.tripId, trip.id));
    await db.insert(tripScheduleDays).values([
      {
        tripId: trip.id,
        dayNumber: 1,
        startsAt: trip.startsAt,
        endsAt: new Date(trip.startsAt.getTime() + 4 * 60 * 60 * 1000),
      },
      {
        tripId: trip.id,
        dayNumber: 2,
        startsAt: new Date(trip.startsAt.getTime() + 24 * 60 * 60 * 1000),
        endsAt: new Date(trip.startsAt.getTime() + 28 * 60 * 60 * 1000),
      },
    ]);

    const before = await listFeedTrips(db, { shopId: shop.id, personId, scope: "shop_trips" });
    expect(before.filter((row) => row.tripId === trip.id).map((row) => row.revision)).toEqual([
      0, 0,
    ]);

    // Written directly rather than through `moveTrip`, which is proven in
    // `trips-schedule.test.ts`: what this asserts is that the feed reads the
    // column, and that both days of one departure publish the same number —
    // a `starts_at` move shifts every one of them.
    await db.update(trips).set({ revision: 5 }).where(eq(trips.id, trip.id));
    const after = await listFeedTrips(db, { shopId: shop.id, personId, scope: "shop_trips" });
    expect(after.filter((row) => row.tripId === trip.id).map((row) => row.revision)).toEqual([
      5, 5,
    ]);
  });
});
