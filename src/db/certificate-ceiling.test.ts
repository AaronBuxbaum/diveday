// @vitest-environment node
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { weekdaySetFrom } from "@/lib/recurrence";
import { fileScopedShopContext } from "@/test/db";
import { cancelBooking, createBooking, restoreBooking } from "./bookings";
import type { AppDb } from "./client";
import { boats, trips } from "./schema";
import {
  applyDetailsToFutureSeries,
  createTrip,
  createTripSeries,
  duplicateTrip,
  rollSeriesForward,
  setTripStatus,
  updateTrip,
} from "./trips";
import { joinTripWaitlist } from "./waitlist";

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

    const joined = await joinTripWaitlist(db, {
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

  it("applying to the rest of the series skips a date on a hull certified for fewer", async () => {
    const { db, shop } = ctx;
    const roomy = await certifiedBoat(db, shop.id, null);
    const small = await certifiedBoat(db, shop.id, LIMIT);
    const created = await createTripSeries(db, {
      shopId: shop.id,
      title: "Saturday",
      capacity: LIMIT,
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
    await updateTrip(db, shop.id, source.id, {
      title: source.title,
      startsAt: source.startsAt,
      endsAt: source.endsAt,
      capacity: STATED,
      plannedDives: source.plannedDives,
    });

    const applied = await applyDetailsToFutureSeries(
      db,
      shop.id,
      created.series.id,
      source.id,
      at("2030-09-01T12:00:00.000Z"),
    );
    expect(applied).toEqual({ updated: 1, skipped: 1 });
    const [smallAfter] = await db.select().from(trips).where(eq(trips.id, onSmall.id));
    const [roomyAfter] = await db.select().from(trips).where(eq(trips.id, onRoomy.id));
    expect(smallAfter?.capacity).toBe(LIMIT);
    expect(roomyAfter?.capacity).toBe(STATED);
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
