// @vitest-environment node
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seatsOpen } from "@/lib/availability";
import { weekdaySetFrom } from "@/lib/recurrence";
import { fileScopedShopContext } from "@/test/db";
import { publicAvailabilityTrips } from "./availability";
import { cancelBooking, createBooking, createBookingParty, restoreBooking } from "./bookings";
import type { AppDb } from "./client";
import { listUpcomingDeparturesForSite } from "./dive-sites";
import { askForDeparture } from "./interests";
import { nextDiveForBooking } from "./next-dive";
import { markBookingNoShow, undoBookingNoShow } from "./no-show";
import { boats, bookings, courses, diveSites, people, trips } from "./schema";
import {
  applyDetailsToFutureSeries,
  createTrip,
  createTripSeries,
  duplicateTrip,
  getTripWithBooked,
  listStaff,
  listUpcomingSessionsForCourse,
  offsetUpcomingTripsWithCounts,
  pagedUpcomingTripsWithCounts,
  rollSeriesForward,
  setTripStatus,
  updateTrip,
} from "./trips";

/**
 * **No path sells seat certificate + 1** (H-107).
 *
 * The forms refuse a capacity above the boat's certificate, but a departure can
 * still carry one: written before H-107, copied, rolled from a series whose
 * template was never re-saved, pushed out by "apply to the rest of the series",
 * or reinstated after a cancel. The point-of-sale ceiling in the booking
 * transaction (`sellableCapacity`) is what makes all of them safe; copy and the
 * series paths also start the new row inside the limit.
 *
 * Every fixture is a hull certified for 2 passengers with departures stating 4.
 */
const ctx = fileScopedShopContext();

const LIMIT = 2;
const STATED = 4;
const SAT = 6;
const at = (iso: string) => new Date(iso);

async function certifiedBoat(db: AppDb, shopId: string, certifiedPassengers: number | null) {
  const [boat] = await db
    .insert(boats)
    .values({
      shopId,
      name: `Hull ${certifiedPassengers ?? "none"}`,
      capacity: 6,
      certifiedPassengers,
    })
    .returning();
  if (!boat) throw new Error("boat not inserted");
  return boat;
}

/** A departure written straight to the database at 4 seats, as a pre-H-107 row would be. */
async function overLimitTrip(
  db: AppDb,
  shopId: string,
  boatId: string,
  startsAt = at("2030-06-01T12:00:00.000Z"),
) {
  const trip = await createTrip(db, {
    shopId,
    title: "Over the limit",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
    capacity: STATED,
    boatId,
  });
  if (!trip) throw new Error("trip not created");
  return trip;
}

let seq = 0;
function book(db: AppDb, shopId: string, tripId: string) {
  seq += 1;
  return createBooking(db, {
    actor: "staff",
    shopId,
    tripId,
    fullName: `Passenger ${seq}`,
    email: `passenger-${seq}@example.com`,
  });
}

async function fillToCertificate(db: AppDb, shopId: string, tripId: string) {
  const ids: string[] = [];
  for (let i = 0; i < LIMIT; i += 1) {
    const outcome = await book(db, shopId, tripId);
    if (!outcome.ok) throw new Error(`seat ${i + 1} refused: ${outcome.reason}`);
    ids.push(outcome.bookingId);
  }
  return ids;
}

describe("the booking transaction caps seats at the boat's certificate", () => {
  it("an over-limit departure sells exactly its certificate, then refuses as full", async () => {
    const { db, shop } = ctx;
    const boat = await certifiedBoat(db, shop.id, LIMIT);
    const trip = await overLimitTrip(db, shop.id, boat.id);

    await fillToCertificate(db, shop.id, trip.id);
    expect(await book(db, shop.id, trip.id)).toMatchObject({ ok: false, reason: "trip_full" });
  });

  it("a boat with no certificate recorded sells its stated capacity", async () => {
    const { db, shop } = ctx;
    const boat = await certifiedBoat(db, shop.id, null);
    const trip = await overLimitTrip(db, shop.id, boat.id);

    for (let i = 0; i < STATED; i += 1) {
      expect((await book(db, shop.id, trip.id)).ok).toBe(true);
    }
    expect(await book(db, shop.id, trip.id)).toMatchObject({ ok: false, reason: "trip_full" });
  });

  it("an undo cannot hand back a seat above the certificate", async () => {
    const { db, shop } = ctx;
    const boat = await certifiedBoat(db, shop.id, LIMIT);
    const trip = await overLimitTrip(db, shop.id, boat.id);
    const [first] = await fillToCertificate(db, shop.id, trip.id);
    if (!first) throw new Error("no seat");

    await cancelBooking(db, shop.id, first);
    expect((await book(db, shop.id, trip.id)).ok).toBe(true);
    // The trip states 4 and holds 2: only the certificate makes this full.
    expect(await restoreBooking(db, shop.id, first)).toBe("trip_full");
  });

  it("the wait list sends a joiner to book only while the certificate has room", async () => {
    const { db, shop } = ctx;
    const boat = await certifiedBoat(db, shop.id, LIMIT);
    const trip = await overLimitTrip(db, shop.id, boat.id);
    await fillToCertificate(db, shop.id, trip.id);

    const joined = await askForDeparture(db, {
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Wendy Waiting",
      email: "wendy@example.com",
    });
    expect(joined.ok).toBe(true);
  });
});

describe("each path that writes a departure from another ends unable to sell above the certificate", () => {
  it("copying a departure starts the copy at the certificate", async () => {
    const { db, shop } = ctx;
    const boat = await certifiedBoat(db, shop.id, LIMIT);
    const source = await overLimitTrip(db, shop.id, boat.id);

    const copy = await duplicateTrip(db, shop.id, source.id, at("2030-06-08T12:00:00.000Z"));
    if (!copy) throw new Error("copy refused");
    expect(copy.capacity).toBe(LIMIT);
    await fillToCertificate(db, shop.id, copy.id);
    expect(await book(db, shop.id, copy.id)).toMatchObject({ ok: false, reason: "trip_full" });
  });

  it("the nightly roll lowers a stale template's seats to a certificate recorded since", async () => {
    const { db, shop } = ctx;
    const boat = await certifiedBoat(db, shop.id, null);
    const created = await createTripSeries(db, {
      shopId: shop.id,
      title: "Saturday on the small hull",
      capacity: STATED,
      plannedDives: 2,
      frequency: "weekly",
      intervalWeeks: 1,
      weekdays: weekdaySetFrom([SAT]),
      anchorDate: "2030-09-07",
      endsOn: null,
      timeZone: "America/New_York",
      boatId: boat.id,
      template: {
        startsAt: at("2030-09-07T11:00:00.000Z"),
        endsAt: at("2030-09-07T15:00:00.000Z"),
      },
    });
    if (!created) throw new Error("series not created");
    const lastBefore = created.trips.at(-1);
    if (!lastBefore) throw new Error("no instances");
    // The certificate is recorded after the series was written; nothing re-saves the template.
    await db.update(boats).set({ certifiedPassengers: LIMIT }).where(eq(boats.id, boat.id));

    const rolled = await rollSeriesForward(
      db,
      shop.id,
      created.series.id,
      at("2030-10-07T12:00:00.000Z"),
    );
    expect(rolled?.created).toBeGreaterThan(0);
    const fresh = await db
      .select()
      .from(trips)
      .where(
        and(
          eq(trips.seriesId, created.series.id),
          gt(trips.startsAt, lastBefore.startsAt),
          isNull(trips.deletedAt),
        ),
      )
      .orderBy(asc(trips.startsAt));
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.every((trip) => trip.capacity === LIMIT)).toBe(true);

    // And an instance rolled before the certificate still sells only up to it.
    const old = created.trips[1];
    if (!old) throw new Error("expected a second instance");
    expect(old.capacity).toBe(STATED);
    await fillToCertificate(db, shop.id, old.id);
    expect(await book(db, shop.id, old.id)).toMatchObject({ ok: false, reason: "trip_full" });
  });

  /** A three-Saturday series on an uncertified hull, its middle date moved to `small`. */
  async function seriesWithMiddleOnSmall(db: AppDb, shopId: string, capacity = LIMIT) {
    const roomy = await certifiedBoat(db, shopId, null);
    const small = await certifiedBoat(db, shopId, LIMIT);
    const created = await createTripSeries(db, {
      shopId,
      title: "Saturday",
      capacity,
      plannedDives: 2,
      frequency: "weekly",
      intervalWeeks: 1,
      weekdays: weekdaySetFrom([SAT]),
      anchorDate: "2030-09-07",
      endsOn: "2030-09-21",
      timeZone: "America/New_York",
      boatId: roomy.id,
      template: {
        startsAt: at("2030-09-07T11:00:00.000Z"),
        endsAt: at("2030-09-07T15:00:00.000Z"),
      },
    });
    if (!created) throw new Error("series not created");
    const [source, onSmall, onRoomy] = created.trips;
    if (!source || !onSmall || !onRoomy) throw new Error("expected three instances");
    await db.update(trips).set({ boatId: small.id }).where(eq(trips.id, onSmall.id));
    return { seriesId: created.series.id, source, onSmall, onRoomy };
  }

  it("applying to the rest of the series lowers only the seats on a hull certified for fewer (#2322)", async () => {
    const { db, shop } = ctx;
    const { seriesId, source, onSmall, onRoomy } = await seriesWithMiddleOnSmall(db, shop.id);
    // Divers-only seats above what the small hull may carry.
    await db.update(trips).set({ diverCapacity: 3 }).where(eq(trips.id, onSmall.id));
    await updateTrip(db, shop.id, source.id, {
      title: "Saturday, renamed",
      startsAt: source.startsAt,
      endsAt: source.endsAt,
      capacity: STATED,
      plannedDives: source.plannedDives,
      priceCents: 12_500,
    });

    const applied = await applyDetailsToFutureSeries(
      db,
      shop.id,
      seriesId,
      source.id,
      at("2030-09-01T12:00:00.000Z"),
    );
    expect(applied).toEqual({ updated: 2, skipped: 0 });
    const [smallAfter] = await db.select().from(trips).where(eq(trips.id, onSmall.id));
    const [roomyAfter] = await db.select().from(trips).where(eq(trips.id, onRoomy.id));
    // Every field reaches the smaller hull's date; only its seats stop at the certificate.
    expect(smallAfter).toMatchObject({
      title: "Saturday, renamed",
      priceCents: 12_500,
      capacity: LIMIT,
      diverCapacity: LIMIT,
    });
    expect(roomyAfter).toMatchObject({
      title: "Saturday, renamed",
      priceCents: 12_500,
      capacity: STATED,
    });
    await fillToCertificate(db, shop.id, onSmall.id);
    expect(await book(db, shop.id, onSmall.id)).toMatchObject({ ok: false, reason: "trip_full" });
  });

  it("still skips a date whose held seats the lowered number would strand", async () => {
    const { db, shop } = ctx;
    const { seriesId, source, onSmall } = await seriesWithMiddleOnSmall(db, shop.id, STATED);
    // Three held on the small hull's date: written before its certificate bound.
    await db.update(trips).set({ boatId: null }).where(eq(trips.id, onSmall.id));
    for (let i = 0; i < 3; i += 1) expect((await book(db, shop.id, onSmall.id)).ok).toBe(true);
    const [small] = await db
      .select({ id: boats.id })
      .from(boats)
      .where(eq(boats.certifiedPassengers, LIMIT));
    await db
      .update(trips)
      .set({ boatId: small?.id ?? null })
      .where(eq(trips.id, onSmall.id));
    await updateTrip(db, shop.id, source.id, {
      title: "Saturday, renamed",
      startsAt: source.startsAt,
      endsAt: source.endsAt,
      capacity: STATED,
      plannedDives: source.plannedDives,
    });

    expect(
      await applyDetailsToFutureSeries(
        db,
        shop.id,
        seriesId,
        source.id,
        at("2030-09-01T12:00:00.000Z"),
      ),
    ).toEqual({ updated: 1, skipped: 1 });
    const [smallAfter] = await db.select().from(trips).where(eq(trips.id, onSmall.id));
    expect(smallAfter).toMatchObject({ title: "Saturday", capacity: STATED });
  });

  it("does not count a no-show as a seat that the new number would strand (#2322)", async () => {
    const { db, shop } = ctx;
    const { seriesId, source, onRoomy } = await seriesWithMiddleOnSmall(db, shop.id, STATED);
    const seats: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const seated = await book(db, shop.id, onRoomy.id);
      if (!seated.ok) throw new Error(`seat refused: ${seated.reason}`);
      seats.push(seated.bookingId);
    }
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("seeded staff missing");
    expect(
      await markBookingNoShow(db, {
        shopId: shop.id,
        bookingId: seats[0] ?? "",
        recordedByPersonId: staff.person.id,
        now: onRoomy.startsAt,
      }),
    ).toMatchObject({ ok: true });
    // One seat held, one released: one seat is enough.
    await updateTrip(db, shop.id, source.id, {
      title: "Saturday, smaller",
      startsAt: source.startsAt,
      endsAt: source.endsAt,
      capacity: 1,
      plannedDives: source.plannedDives,
    });

    await applyDetailsToFutureSeries(
      db,
      shop.id,
      seriesId,
      source.id,
      at("2030-09-01T12:00:00.000Z"),
    );
    const [roomyAfter] = await db.select().from(trips).where(eq(trips.id, onRoomy.id));
    expect(roomyAfter).toMatchObject({ title: "Saturday, smaller", capacity: 1 });
  });

  it("a reinstated over-limit departure still refuses seat certificate + 1", async () => {
    const { db, shop } = ctx;
    const boat = await certifiedBoat(db, shop.id, LIMIT);
    const trip = await overLimitTrip(db, shop.id, boat.id);
    await setTripStatus(db, shop.id, trip.id, "cancelled");
    await setTripStatus(db, shop.id, trip.id, "scheduled");

    await fillToCertificate(db, shop.id, trip.id);
    expect(await book(db, shop.id, trip.id)).toMatchObject({ ok: false, reason: "trip_full" });
  });
});

/**
 * **Every count a diver reads measures seats on sale, not seats stated**
 * (#2321). An over-limit departure that the booking transaction refuses at
 * the certificate must not be shown — on the schedule, the trip page, the
 * site and course pages, the availability document, the recap's next-dive
 * card or the staff picker — as having a seat past it.
 */
describe("every reader counts seats against the certificate", () => {
  const SOON = at("2030-05-31T12:00:00.000Z");

  async function overLimitWithOneSeated(db: AppDb, shopId: string) {
    const boat = await certifiedBoat(db, shopId, LIMIT);
    const trip = await overLimitTrip(db, shopId, boat.id);
    const seated = await book(db, shopId, trip.id);
    if (!seated.ok) throw new Error(`seat refused: ${seated.reason}`);
    return trip;
  }

  it("the board's reads carry the sellable number beside the stated one, and hasSpace uses it", async () => {
    const { db, shop } = ctx;
    const trip = await overLimitWithOneSeated(db, shop.id);
    const board = async () =>
      (await pagedUpcomingTripsWithCounts(db, shop.id, { now: SOON, hasSpace: true })).trips;
    const picker = async () =>
      (await offsetUpcomingTripsWithCounts(db, shop.id, { now: SOON, hasSpace: true })).trips;

    const [row] = (await board()).filter((t) => t.id === trip.id);
    expect(row).toMatchObject({ capacity: STATED, sellableCapacity: LIMIT, booked: 1 });
    expect((await picker()).some((t) => t.id === trip.id)).toBe(true);

    expect((await book(db, shop.id, trip.id)).ok).toBe(true);
    // Two of four stated seats are held; the certificate makes it full.
    expect((await board()).some((t) => t.id === trip.id)).toBe(false);
    expect((await picker()).some((t) => t.id === trip.id)).toBe(false);
    const all = await offsetUpcomingTripsWithCounts(db, shop.id, { now: SOON });
    expect(all.trips.find((t) => t.id === trip.id)?.sellableCapacity).toBe(LIMIT);
  });

  it("the single-departure read keeps the stated capacity for the form and adds the sellable one", async () => {
    const { db, shop } = ctx;
    const trip = await overLimitWithOneSeated(db, shop.id);
    expect(await getTripWithBooked(db, shop.id, trip.id)).toMatchObject({
      capacity: STATED,
      sellableCapacity: LIMIT,
      booked: 1,
    });
  });

  it("a departure with no boat, or a boat with no certificate, sells what it states", async () => {
    const { db, shop } = ctx;
    const uncertified = await certifiedBoat(db, shop.id, null);
    const onHull = await overLimitTrip(db, shop.id, uncertified.id);
    const ashore = await createTrip(db, {
      shopId: shop.id,
      title: "No boat",
      startsAt: at("2030-06-01T12:00:00.000Z"),
      endsAt: at("2030-06-01T16:00:00.000Z"),
      capacity: STATED,
    });
    if (!ashore) throw new Error("trip not created");
    for (const id of [onHull.id, ashore.id]) {
      expect((await getTripWithBooked(db, shop.id, id))?.sellableCapacity).toBe(STATED);
    }
  });

  it("the availability document offers only the seats left under the certificate", async () => {
    const { db, shop } = ctx;
    const trip = await overLimitWithOneSeated(db, shop.id);
    const rows = await publicAvailabilityTrips(db, shop, SOON);
    const listed = rows.find((row) => row.id === trip.id);
    expect(listed).toBeDefined();
    if (!listed) return;
    expect(seatsOpen(listed)).toBe(LIMIT - 1);
  });

  it("the recap's next-dive card says the seats left under the certificate", async () => {
    const { db, shop } = ctx;
    const trip = await overLimitWithOneSeated(db, shop.id);
    const [diver] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.shopId, shop.id))
      .limit(1);
    if (!diver) throw new Error("seeded person missing");
    const pick = await nextDiveForBooking(db, {
      shopId: shop.id,
      personId: diver.id,
      justDivedTripId: "00000000-0000-0000-0000-0000000000ff",
      dayCourseId: null,
      dayShoutout: null,
      daySiteNames: [],
      dayLensId: null,
      now: SOON,
    });
    expect(pick).toMatchObject({ tripId: trip.id, seatsLeft: LIMIT - 1 });
  });

  it("a dive site's page counts its departures' seats against the certificate", async () => {
    const { db, shop } = ctx;
    const [site] = await db
      .select({ id: diveSites.id })
      .from(diveSites)
      .where(and(eq(diveSites.shopId, shop.id), isNull(diveSites.deletedAt)))
      .limit(1);
    if (!site) throw new Error("seeded site missing");
    const boat = await certifiedBoat(db, shop.id, LIMIT);
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Over the limit, at a site",
      startsAt: at("2030-06-01T12:00:00.000Z"),
      endsAt: at("2030-06-01T16:00:00.000Z"),
      capacity: STATED,
      boatId: boat.id,
      dives: [{ diveSiteId: site.id }],
    });
    if (!trip) throw new Error("trip not created");
    const departures = await listUpcomingDeparturesForSite(db, shop.id, site.id, SOON);
    expect(departures.find((d) => d.id === trip.id)?.capacity).toBe(LIMIT);
  });

  it("a course page counts its sessions' seats against the certificate", async () => {
    const { db, shop } = ctx;
    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.shopId, shop.id))
      .limit(1);
    if (!course) throw new Error("seeded course missing");
    const boat = await certifiedBoat(db, shop.id, LIMIT);
    const session = await createTrip(db, {
      shopId: shop.id,
      courseId: course.id,
      title: "Over the limit, a session",
      startsAt: at("2030-06-01T12:00:00.000Z"),
      endsAt: at("2030-06-01T16:00:00.000Z"),
      capacity: STATED,
      boatId: boat.id,
    });
    if (!session) throw new Error("session not created");
    const sessions = await listUpcomingSessionsForCourse(db, shop.id, course.id, SOON);
    expect(sessions.find((s) => s.id === session.id)?.capacity).toBe(LIMIT);
  });
});

/**
 * The paths H-107's first pass did not pin (#2323): handing a released seat
 * back, a party that crosses the line partway, and a boat whose non-divers
 * fill the certificate while the divers-only limit still looks open.
 */
describe("the certificate holds on the paths that hand back or split a seat", () => {
  async function staffId(db: AppDb, shopId: string) {
    const [staff] = await listStaff(db, shopId);
    if (!staff) throw new Error("seeded staff missing");
    return staff.person.id;
  }

  it("undoing a no-show on a departure already at its certificate is refused", async () => {
    const { db, shop } = ctx;
    const boat = await certifiedBoat(db, shop.id, LIMIT);
    const trip = await overLimitTrip(db, shop.id, boat.id);
    const [absent] = await fillToCertificate(db, shop.id, trip.id);
    if (!absent) throw new Error("no seat");
    const recordedByPersonId = await staffId(db, shop.id);

    const marked = await markBookingNoShow(db, {
      shopId: shop.id,
      bookingId: absent,
      recordedByPersonId,
      now: trip.startsAt,
    });
    expect(marked).toMatchObject({ ok: true });
    // The released seat is sold to someone at the desk.
    expect((await book(db, shop.id, trip.id)).ok).toBe(true);

    // The trip states 4 and holds 2: only the certificate makes this full.
    expect(
      await undoBookingNoShow(db, {
        shopId: shop.id,
        bookingId: absent,
        recordedByPersonId,
        now: trip.startsAt,
      }),
    ).toMatchObject({ ok: false, reason: "trip_full" });
    const [row] = await db
      .select({ status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, absent));
    expect(row?.status).toBe("no_show");
  });

  it("a party that crosses the certificate partway through is refused whole", async () => {
    const { db, shop } = ctx;
    const boat = await certifiedBoat(db, shop.id, LIMIT);
    const trip = await overLimitTrip(db, shop.id, boat.id);
    expect((await book(db, shop.id, trip.id)).ok).toBe(true);

    const party = await createBookingParty(
      db,
      ["Party Lead", "Party Two", "Party Three"].map((fullName, index) => ({
        actor: "staff" as const,
        shopId: shop.id,
        tripId: trip.id,
        fullName,
        email: `party-${index}-${seq}@example.com`,
      })),
    );
    // The lead fits under the certificate; the second would be seat 3.
    expect(party).toMatchObject({ ok: false, reason: "trip_full", failedIndex: 1 });
    // Nobody from the party is left holding the one seat that did fit.
    const held = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.tripId, trip.id), eq(bookings.status, "booked")));
    expect(held).toHaveLength(1);
    expect((await book(db, shop.id, trip.id)).ok).toBe(true);
  });

  it("snorkelers and riders filling the certificate block a diver the divers-only limit would admit", async () => {
    const { db, shop } = ctx;
    const boat = await certifiedBoat(db, shop.id, LIMIT);
    const trip = await overLimitTrip(db, shop.id, boat.id);
    // Three divers-only seats on a departure stating four: every one looks free.
    await db.update(trips).set({ diverCapacity: 3 }).where(eq(trips.id, trip.id));

    for (const participantType of ["snorkeler", "rider"] as const) {
      seq += 1;
      const seated = await createBooking(db, {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: `Surface ${seq}`,
        email: `surface-${seq}@example.com`,
        participantType,
      });
      expect(seated).toMatchObject({ ok: true });
    }

    expect(await book(db, shop.id, trip.id)).toMatchObject({ ok: false, reason: "trip_full" });
    const counted = await getTripWithBooked(db, shop.id, trip.id);
    expect(counted).toMatchObject({ booked: LIMIT, bookedDivers: 0, sellableCapacity: LIMIT });
  });
});
