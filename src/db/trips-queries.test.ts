import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { createDiveSite } from "./dive-sites";
import { bookings, shops, trips } from "./schema";
import {
  countShopTrips,
  createTrip,
  offsetUpcomingTripsWithCounts,
  pagedUpcomingTripsWithCounts,
  SCHEDULE_PAGE_SIZE,
  setTripStatus,
  tripDiveSiteSummaries,
  upcomingScheduleRange,
  upcomingScheduleStats,
  upcomingTripsWithCounts,
  updateTrip,
} from "./trips";

describe("demo seed + schedule queries (in-memory PGlite)", () => {
  it("returns upcoming trips ordered by start with correct booked counts", async () => {
    const { db, shop } = await seededShopContext();

    const upcoming = await upcomingTripsWithCounts(db, shop.id);
    // 42 before `seed-cert-gates.ts` added the four departures whose cert gates
    // each refuse for exactly one reason (the AOW course session, the
    // Advanced-only drift, the Duane deep sailing, and the nitrox charter), and
    // 46 before `seed-counter-blockers.ts` added the one boat that demands
    // everything at once — the counter's five-reason card, and 47 before
    // `seed-minimum-seats.ts` added the long-range run that only sails with
    // six aboard (ADR 20260813-minimum-head-count-departures).
    expect(upcoming).toHaveLength(48);

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

  /**
   * The add-booking picker's reader. The board keeps its cursor stack — it
   * walks a stream forward — but a *pick one departure* step needs to say
   * "page 2 of 4" and go back, so it reads the same list through `offsetPage`
   * (ADR 20260803-one-pagination-model).
   */
  it("offset-pages the same list the board keysets, with an honest count", async () => {
    const { db, shop } = await seededShopContext();
    const all = await upcomingTripsWithCounts(db, shop.id);

    const first = await offsetUpcomingTripsWithCounts(db, shop.id, { limit: 5 });
    expect(first.total).toBe(all.length);
    expect(first.pageCount).toBe(Math.ceil(all.length / 5));

    const seen: string[] = [];
    for (let page = 1; page <= first.pageCount; page += 1) {
      const chunk = await offsetUpcomingTripsWithCounts(db, shop.id, { page, limit: 5 });
      expect(chunk.page).toBe(page);
      expect(chunk.total).toBe(all.length);
      seen.push(...chunk.trips.map((trip) => trip.id));
    }
    expect(seen).toEqual(all.map((trip) => trip.id));

    // Back one page is the page you came from — the capability the picker's
    // "go look at the board" link never had.
    const second = await offsetUpcomingTripsWithCounts(db, shop.id, { page: 2, limit: 5 });
    const back = await offsetUpcomingTripsWithCounts(db, shop.id, { page: 1, limit: 5 });
    expect(back.trips.map((trip) => trip.id)).toEqual(first.trips.map((trip) => trip.id));
    expect(second.trips.map((trip) => trip.id)).not.toEqual(back.trips.map((trip) => trip.id));

    for (const requested of [0, -3, Number.NaN]) {
      const clamped = await offsetUpcomingTripsWithCounts(db, shop.id, {
        page: requested,
        limit: 5,
      });
      expect(clamped.page).toBe(1);
      expect(clamped.trips.map((trip) => trip.id)).toEqual(first.trips.map((trip) => trip.id));
    }

    const past = await offsetUpcomingTripsWithCounts(db, shop.id, { page: 999, limit: 5 });
    expect(past.page).toBe(past.pageCount);
    expect(past.trips.length).toBeGreaterThan(0);
  });

  /**
   * The picker filters to departures with a seat left, so its count has to be
   * taken over the same `having`-filtered set. Counting `trips` directly would
   * page a sold-out Saturday into "page 3 of 5" and then render nothing there.
   */
  it("counts only the departures its filters actually list", async () => {
    const { db, shop } = await seededShopContext();
    const all = await upcomingTripsWithCounts(db, shop.id);
    const withSpaceCount = all.filter((trip) => trip.booked < trip.capacity).length;
    expect(withSpaceCount).toBeLessThan(all.length); // the seed has a full trip

    const spaced = await offsetUpcomingTripsWithCounts(db, shop.id, { hasSpace: true, limit: 5 });
    expect(spaced.total).toBe(withSpaceCount);
    expect(spaced.pageCount).toBe(Math.ceil(withSpaceCount / 5));

    const everySpaced: string[] = [];
    for (let page = 1; page <= spaced.pageCount; page += 1) {
      const chunk = await offsetUpcomingTripsWithCounts(db, shop.id, {
        hasSpace: true,
        page,
        limit: 5,
      });
      everySpaced.push(...chunk.trips.map((trip) => trip.id));
    }
    expect(everySpaced).toHaveLength(withSpaceCount);
    expect(new Set(everySpaced).size).toBe(withSpaceCount);

    const courses = await offsetUpcomingTripsWithCounts(db, shop.id, {
      tripType: "course",
      limit: 5,
    });
    expect(courses.total).toBe(all.filter((trip) => trip.course !== null).length);
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

describe("countShopTrips", () => {
  it("counts only the shop's own departures, from zero, including past and cancelled ones", async () => {
    const { db, shop } = await seededShopContext();

    // A brand-new shop next door: zero, untouched by the seeded shop's board.
    const [fresh] = await db
      .insert(shops)
      .values({ name: "Fresh Count", slug: "fresh-count", timezone: "America/New_York" })
      .returning();
    if (!fresh) throw new Error("shop not created");
    expect(await countShopTrips(db, fresh.id)).toBe(0);

    const first = await createTrip(db, {
      shopId: fresh.id,
      title: "First ever",
      startsAt: new Date("2030-08-15T12:00:00Z"),
      endsAt: new Date("2030-08-15T16:00:00Z"),
      capacity: 4,
    });
    if (!first) throw new Error("trip not created");
    expect(await countShopTrips(db, fresh.id)).toBe(1);

    // Cancelled still counts: "has this shop ever scheduled?" is the question
    // the bookable-moment caller asks, and a cancelled trip answers yes.
    await setTripStatus(db, fresh.id, first.id, "cancelled");
    expect(await countShopTrips(db, fresh.id)).toBe(1);

    // The seeded shop's own count never bleeds in.
    expect(await countShopTrips(db, shop.id)).toBeGreaterThan(1);
  });
});

describe("tripDiveSiteSummaries", () => {
  /** Two sites and a departure that visits them however the test says. */
  const twoSiteShop = async () => {
    const { db, shop } = await seededShopContext();
    const benwood = await createDiveSite(db, { shopId: shop.id, name: "Test Benwood" });
    const elbow = await createDiveSite(db, { shopId: shop.id, name: "Test Elbow" });
    return { db, shop, benwood, elbow };
  };

  it("names both sites of a two-site day, in dive order", async () => {
    const { db, shop, benwood, elbow } = await twoSiteShop();
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Two-site day",
      startsAt: new Date("2030-08-15T12:00:00Z"),
      endsAt: new Date("2030-08-15T16:00:00Z"),
      capacity: 4,
      plannedDives: 2,
      dives: [{ diveSiteId: benwood.id }, { diveSiteId: elbow.id }],
    });
    if (!trip) throw new Error("trip not created");

    const summaries = await tripDiveSiteSummaries(db, shop.id, [trip.id]);
    expect(summaries.get(trip.id)).toEqual({
      sites: [
        { id: benwood.id, name: "Test Benwood" },
        { id: elbow.id, name: "Test Elbow" },
      ],
      undecidedDives: 0,
    });
  });

  it("reports the open tank of a two-tank day with one site chosen", async () => {
    const { db, shop, benwood } = await twoSiteShop();
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "One site so far",
      startsAt: new Date("2030-08-15T12:00:00Z"),
      endsAt: new Date("2030-08-15T16:00:00Z"),
      capacity: 4,
      plannedDives: 2,
      dives: [{ diveSiteId: benwood.id }, {}],
    });
    if (!trip) throw new Error("trip not created");

    expect((await tripDiveSiteSummaries(db, shop.id, [trip.id])).get(trip.id)).toEqual({
      sites: [{ id: benwood.id, name: "Test Benwood" }],
      undecidedDives: 1,
    });
  });

  it("finds the site when only the *second* tank has one, and reports the open first tank", async () => {
    const { db, shop, elbow } = await twoSiteShop();
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Second tank only",
      startsAt: new Date("2030-08-15T12:00:00Z"),
      endsAt: new Date("2030-08-15T16:00:00Z"),
      capacity: 4,
      plannedDives: 2,
      dives: [{}, { diveSiteId: elbow.id }],
    });
    if (!trip) throw new Error("trip not created");

    expect((await tripDiveSiteSummaries(db, shop.id, [trip.id])).get(trip.id)).toEqual({
      sites: [{ id: elbow.id, name: "Test Elbow" }],
      undecidedDives: 1,
    });
    // The reader never depends on the pointer agreeing with the dives — see
    // "prefers the dives over the pointer when both exist and disagree" below.
  });

  it("counts one site when the same site is dived twice", async () => {
    const { db, shop, benwood } = await twoSiteShop();
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Same site twice",
      startsAt: new Date("2030-08-15T12:00:00Z"),
      endsAt: new Date("2030-08-15T16:00:00Z"),
      capacity: 4,
      plannedDives: 2,
      dives: [{ diveSiteId: benwood.id }, { diveSiteId: benwood.id }],
    });
    if (!trip) throw new Error("trip not created");

    expect((await tripDiveSiteSummaries(db, shop.id, [trip.id])).get(trip.id)).toEqual({
      sites: [{ id: benwood.id, name: "Test Benwood" }],
      undecidedDives: 0,
    });
  });

  it("returns nothing for another shop's departure, and an empty map for no ids", async () => {
    const { db, shop, benwood } = await twoSiteShop();
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Not yours",
      startsAt: new Date("2030-08-15T12:00:00Z"),
      endsAt: new Date("2030-08-15T16:00:00Z"),
      capacity: 4,
      plannedDives: 2,
      dives: [{ diveSiteId: benwood.id }, {}],
    });
    if (!trip) throw new Error("trip not created");
    const [neighbour] = await db
      .insert(shops)
      .values({ name: "Next Door", slug: "next-door-sites", timezone: "America/New_York" })
      .returning();
    if (!neighbour) throw new Error("shop not created");

    expect((await tripDiveSiteSummaries(db, neighbour.id, [trip.id])).size).toBe(0);
    expect((await tripDiveSiteSummaries(db, shop.id, [])).size).toBe(0);
  });

  it("summarises the whole page of departures in one read", async () => {
    const { db, shop, benwood, elbow } = await twoSiteShop();
    const first = await createTrip(db, {
      shopId: shop.id,
      title: "Page trip one",
      startsAt: new Date("2030-08-15T12:00:00Z"),
      endsAt: new Date("2030-08-15T16:00:00Z"),
      capacity: 4,
      plannedDives: 2,
      dives: [{ diveSiteId: benwood.id }, { diveSiteId: elbow.id }],
    });
    const second = await createTrip(db, {
      shopId: shop.id,
      title: "Page trip two",
      startsAt: new Date("2030-08-16T12:00:00Z"),
      endsAt: new Date("2030-08-16T16:00:00Z"),
      capacity: 4,
      plannedDives: 1,
      dives: [{}],
    });
    if (!first || !second) throw new Error("trip not created");

    const summaries = await tripDiveSiteSummaries(db, shop.id, [first.id, second.id]);
    expect(summaries.get(first.id)?.sites).toHaveLength(2);
    expect(summaries.get(second.id)).toEqual({ sites: [], undecidedDives: 1 });
  });
});

describe("tripDiveSiteSummaries — a departure with no dive rows", () => {
  /**
   * Every write path mints one `trip_dives` row per planned dive, so this shape
   * only reaches the reader from data written around them (the demo seed's
   * `seed-more-trips.ts` does exactly that today). The reader falls back to the
   * trip's own pointer rather than telling a diver the boat goes nowhere.
   */
  it("falls back to the trip's own site, and says nothing when there isn't one", async () => {
    const { db, shop } = await seededShopContext();
    const site = await createDiveSite(db, { shopId: shop.id, name: "Test Fallback Reef" });
    const [withPointer] = await db
      .insert(trips)
      .values({
        shopId: shop.id,
        diveSiteId: site.id,
        title: "Row-only trip",
        startsAt: new Date("2030-08-15T12:00:00Z"),
        endsAt: new Date("2030-08-15T16:00:00Z"),
        capacity: 4,
      })
      .returning();
    const [withoutPointer] = await db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Row-only trip, no site",
        startsAt: new Date("2030-08-16T12:00:00Z"),
        endsAt: new Date("2030-08-16T16:00:00Z"),
        capacity: 4,
      })
      .returning();
    if (!withPointer || !withoutPointer) throw new Error("trip not created");

    const summaries = await tripDiveSiteSummaries(db, shop.id, [withPointer.id, withoutPointer.id]);
    expect(summaries.get(withPointer.id)).toEqual({
      sites: [{ id: site.id, name: "Test Fallback Reef" }],
      undecidedDives: 0,
    });
    // Absent, not `{ sites: [], undecidedDives: 0 }` — a surface must not read
    // "no dives are open" from a trip that never described its dives.
    expect(summaries.has(withoutPointer.id)).toBe(false);
  });

  it("prefers the dives over the pointer when both exist and disagree", async () => {
    const { db, shop } = await seededShopContext();
    const stale = await createDiveSite(db, { shopId: shop.id, name: "Test Stale Pointer" });
    const real = await createDiveSite(db, { shopId: shop.id, name: "Test Real Site" });
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Pointer disagrees",
      startsAt: new Date("2030-08-15T12:00:00Z"),
      endsAt: new Date("2030-08-15T16:00:00Z"),
      capacity: 4,
      plannedDives: 1,
      dives: [{ diveSiteId: real.id }],
    });
    if (!trip) throw new Error("trip not created");
    await db.update(trips).set({ diveSiteId: stale.id }).where(eq(trips.id, trip.id));

    expect((await tripDiveSiteSummaries(db, shop.id, [trip.id])).get(trip.id)).toEqual({
      sites: [{ id: real.id, name: "Test Real Site" }],
      undecidedDives: 0,
    });
  });
});

describe("trips.dive_site_id — the denormalized pointer the forecast and calendar feed read", () => {
  /**
   * It used to be strictly *dive one's* site, so a departure planned second
   * tank first stored null and offered no forecast point, no calendar
   * `LOCATION`, and no directions — for a trip that plainly visits a site.
   * Never a gate: readiness unions the pointer with every `trip_dives` site, so
   * widening it can only add a site the trip already visits.
   */
  it("points at the first dive that has a site, not strictly dive one", async () => {
    const { db, shop } = await seededShopContext();
    const elbow = await createDiveSite(db, { shopId: shop.id, name: "Test Second Tank Only" });
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Second tank planned first",
      startsAt: new Date("2030-08-15T12:00:00Z"),
      endsAt: new Date("2030-08-15T16:00:00Z"),
      capacity: 4,
      plannedDives: 2,
      dives: [{}, { diveSiteId: elbow.id }],
    });
    if (!trip) throw new Error("trip not created");
    expect(trip.diveSiteId).toBe(elbow.id);
  });

  it("still prefers dive one when dive one has a site", async () => {
    const { db, shop } = await seededShopContext();
    const first = await createDiveSite(db, { shopId: shop.id, name: "Test Tank One" });
    const second = await createDiveSite(db, { shopId: shop.id, name: "Test Tank Two" });
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Both tanks sited",
      startsAt: new Date("2030-08-15T12:00:00Z"),
      endsAt: new Date("2030-08-15T16:00:00Z"),
      capacity: 4,
      plannedDives: 2,
      dives: [{ diveSiteId: first.id }, { diveSiteId: second.id }],
    });
    if (!trip) throw new Error("trip not created");
    expect(trip.diveSiteId).toBe(first.id);
  });

  it("stays null when no tank has a site at all", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Nothing chosen",
      startsAt: new Date("2030-08-15T12:00:00Z"),
      endsAt: new Date("2030-08-15T16:00:00Z"),
      capacity: 4,
      plannedDives: 2,
      dives: [{}, {}],
    });
    if (!trip) throw new Error("trip not created");
    expect(trip.diveSiteId).toBeNull();
  });

  it("follows an edit that moves the site from tank one to tank two", async () => {
    const { db, shop } = await seededShopContext();
    const first = await createDiveSite(db, { shopId: shop.id, name: "Test Edit Tank One" });
    const second = await createDiveSite(db, { shopId: shop.id, name: "Test Edit Tank Two" });
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Plan changes",
      startsAt: new Date("2030-08-15T12:00:00Z"),
      endsAt: new Date("2030-08-15T16:00:00Z"),
      capacity: 4,
      plannedDives: 2,
      dives: [{ diveSiteId: first.id }, {}],
    });
    if (!trip) throw new Error("trip not created");

    const outcome = await updateTrip(db, shop.id, trip.id, {
      title: trip.title,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      capacity: trip.capacity,
      plannedDives: 2,
      // What the trip editor sends: the form's dive-one site, which is now blank.
      diveSiteId: null,
      dives: [{ diveSiteId: null }, { diveSiteId: second.id }],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("update refused");
    expect(outcome.trip.diveSiteId).toBe(second.id);

    // And the surfaces still read the dives, which is the answer that matters.
    expect((await tripDiveSiteSummaries(db, shop.id, [trip.id])).get(trip.id)).toEqual({
      sites: [{ id: second.id, name: "Test Edit Tank Two" }],
      undecidedDives: 1,
    });
  });
});
