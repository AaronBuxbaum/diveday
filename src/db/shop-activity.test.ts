import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ACTIVITY_REDACTED } from "@/lib/activity";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import type { AppDb } from "./client";
import {
  activityEvents,
  orders,
  reviewModerationEvents,
  tripChangeEvents,
  tripReviews,
  trips,
} from "./schema";
import { listShopActivityPeople, pagedShopActivity, recordShopActivity } from "./shop-activity";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`): every test here writes rows and
// reads them back, and nothing moves money or holds a lock.
const ctx = fileScopedShopContext();

const OTHER_SHOP = "99999999-8888-4777-8666-555555555555";

async function bookedSeat(db: AppDb, shopId: string) {
  const trip = (await upcomingTripsWithCounts(db, shopId)).find((row) => row.booked > 0);
  if (!trip) throw new Error("expected a booked trip");
  const [seat] = await getTripRoster(db, shopId, trip.id);
  const staff = await listStaff(db, shopId);
  const owner = staff.find((member) => member.roles.includes("owner"));
  if (!seat || !owner) throw new Error("expected seeded people");
  return { trip, seat, owner: owner.person };
}

/** Only the lines this test wrote: the seeded demo trail is there too. */
async function linesBy(db: AppDb, shopId: string, actorPersonId: string, kind?: "money") {
  return pagedShopActivity(db, shopId, { actorPersonId, kind }, { pageSize: 200 });
}

describe("recordShopActivity", () => {
  it("names the actor and the diver, and files a seat line on its booking", async () => {
    const { db, shop } = ctx;
    const { trip, seat, owner } = await bookedSeat(db, shop.id);

    expect(
      await recordShopActivity(db, {
        shopId: shop.id,
        actorPersonId: owner.id,
        write: { code: "payment_waived", bookingId: seat.booking.id },
      }),
    ).toBe(true);

    const [row] = await db
      .select()
      .from(activityEvents)
      .where(and(eq(activityEvents.shopId, shop.id), eq(activityEvents.code, "payment_waived")));
    // The booking is the handle `anonymizeDiver` redacts a named line by.
    expect(row).toMatchObject({
      tripId: trip.id,
      bookingId: seat.booking.id,
      actorPersonId: owner.id,
      params: { actor: owner.fullName, diver: seat.person.fullName },
    });
  });

  it("files an order refund on the order and its customer, with no name in it", async () => {
    const { db, shop } = ctx;
    const { seat, owner } = await bookedSeat(db, shop.id);
    const [order] = await db
      .insert(orders)
      .values({
        shopId: shop.id,
        personId: seat.person.id,
        createdByPersonId: owner.id,
        currency: "usd",
        totalCents: 12000,
        collection: "cash",
      })
      .returning();
    if (!order) throw new Error("order not written");

    expect(
      await recordShopActivity(db, {
        shopId: shop.id,
        actorPersonId: owner.id,
        write: { code: "order_refunded", orderId: order.id },
      }),
    ).toBe(true);

    const log = await linesBy(db, shop.id, owner.id, "money");
    const line = log.rows.find((row) => row.code === "order_refunded");
    expect(line).toMatchObject({
      orderId: order.id,
      subjectPersonId: seat.person.id,
      actorName: owner.fullName,
      params: { actor: owner.fullName },
    });
  });

  it("writes nothing about another shop's seat, order or departure, or for an outsider", async () => {
    const { db, shop } = ctx;
    const { trip, seat, owner } = await bookedSeat(db, shop.id);

    for (const write of [
      { code: "seat_refunded", bookingId: seat.booking.id },
      { code: "departure_moved", tripId: trip.id },
    ] as const) {
      expect(
        await recordShopActivity(db, { shopId: OTHER_SHOP, actorPersonId: owner.id, write }),
      ).toBe(false);
    }
    // A real shop, an actor who is not one of its people.
    expect(
      await recordShopActivity(db, {
        shopId: shop.id,
        actorPersonId: OTHER_SHOP,
        write: { code: "departure_moved", tripId: trip.id },
      }),
    ).toBe(false);
    expect(
      await recordShopActivity(db, {
        shopId: shop.id,
        actorPersonId: owner.id,
        write: { code: "order_refunded", orderId: "not-a-uuid" },
      }),
    ).toBe(false);
  });

  it("records a departure deleted after the delete it describes", async () => {
    const { db, shop } = ctx;
    const { trip, owner } = await bookedSeat(db, shop.id);
    await db.update(trips).set({ deletedAt: nowDate() }).where(eq(trips.id, trip.id));

    expect(
      await recordShopActivity(db, {
        shopId: shop.id,
        actorPersonId: owner.id,
        write: { code: "departure_deleted", tripId: trip.id },
      }),
    ).toBe(true);

    const log = await pagedShopActivity(
      db,
      shop.id,
      { actorPersonId: owner.id, kind: "departures" },
      { pageSize: 200 },
    );
    // Still named, and marked as having no page to link to.
    expect(log.rows.find((row) => row.code === "departure_deleted")).toMatchObject({
      tripId: trip.id,
      tripTitle: trip.title,
      tripLive: false,
    });
  });
});

describe("pagedShopActivity", () => {
  it("reads the three trails as one log, each line naming who did it", async () => {
    const { db, shop } = ctx;
    const { trip, seat, owner } = await bookedSeat(db, shop.id);
    const [review] = await db
      .insert(tripReviews)
      .values({
        shopId: shop.id,
        bookingId: seat.booking.id,
        tripId: trip.id,
        personId: seat.person.id,
        rating: 5,
      })
      .returning({ id: tripReviews.id });
    if (!review) throw new Error("review not written");

    await db.insert(reviewModerationEvents).values({
      shopId: shop.id,
      reviewId: review.id,
      action: "hidden",
      reason: "spam",
      recordedByPersonId: owner.id,
    });
    await db.insert(tripChangeEvents).values({
      shopId: shop.id,
      tripId: trip.id,
      kind: "meeting_point",
      source: "shop",
      afterValue: { label: "Dock B" },
      actorPersonId: owner.id,
    });
    await recordShopActivity(db, {
      shopId: shop.id,
      actorPersonId: owner.id,
      write: { code: "departure_moved", tripId: trip.id },
    });

    const log = await pagedShopActivity(
      db,
      shop.id,
      { actorPersonId: owner.id },
      { pageSize: 200 },
    );
    const sources = new Set(log.rows.map((row) => row.source));
    expect(sources).toEqual(new Set(["activity", "review", "trip_change"]));
    for (const row of log.rows) expect(row.actorName).toBe(owner.fullName);
    expect(log.rows.find((row) => row.source === "trip_change")).toMatchObject({
      code: "meeting_point",
      tripId: trip.id,
      tripLive: true,
    });

    // The kind filter keeps one trail's lines and drops the others whole.
    const reviews = await pagedShopActivity(
      db,
      shop.id,
      { actorPersonId: owner.id, kind: "reviews" },
      { pageSize: 200 },
    );
    expect(reviews.rows.map((row) => row.source)).toEqual(["review"]);
    expect(reviews.total).toBe(1);
  });

  it("leaves out a plan change nobody is named on", async () => {
    const { db, shop } = ctx;
    const { trip } = await bookedSeat(db, shop.id);
    const before = (await pagedShopActivity(db, shop.id, { kind: "departures" })).total;
    await db.insert(tripChangeEvents).values({
      shopId: shop.id,
      tripId: trip.id,
      kind: "conditions",
      source: "crew",
      afterValue: { note: "Flat" },
      actorPersonId: null,
    });
    expect((await pagedShopActivity(db, shop.id, { kind: "departures" })).total).toBe(before);
  });

  it("counts exactly what it pages, under a date window", async () => {
    const { db, shop } = ctx;
    const { trip, owner } = await bookedSeat(db, shop.id);
    const now = nowDate();
    const longAgo = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000);
    await db.insert(activityEvents).values([
      {
        shopId: shop.id,
        tripId: trip.id,
        actorPersonId: owner.id,
        code: "departure_moved",
        params: { actor: owner.fullName },
        occurredAt: longAgo,
      },
      {
        shopId: shop.id,
        tripId: trip.id,
        actorPersonId: owner.id,
        code: "departure_copied",
        params: { actor: owner.fullName },
        occurredAt: now,
      },
    ]);

    const recent = await pagedShopActivity(
      db,
      shop.id,
      {
        actorPersonId: owner.id,
        from: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        to: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      },
      { pageSize: 200 },
    );
    expect(recent.rows.some((row) => row.code === "departure_copied")).toBe(true);
    expect(recent.rows.some((row) => row.code === "departure_moved")).toBe(false);
    expect(recent.total).toBe(recent.rows.length);

    const firstPage = await pagedShopActivity(db, shop.id, {}, { pageSize: 3 });
    expect(firstPage.rows).toHaveLength(3);
    expect(firstPage.pageCount).toBe(Math.ceil(firstPage.total / 3));
    // Newest first.
    const times = firstPage.rows.map((row) => row.occurredAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("reads nothing through another shop, a malformed id, or another shop's actor", async () => {
    const { db, shop } = ctx;
    const { owner } = await bookedSeat(db, shop.id);
    expect((await pagedShopActivity(db, shop.id)).total).toBeGreaterThan(0);
    expect(await pagedShopActivity(db, OTHER_SHOP)).toMatchObject({ total: 0, rows: [] });
    expect(await pagedShopActivity(db, shop.id, { actorPersonId: "not-a-uuid" })).toMatchObject({
      total: 0,
      rows: [],
    });
    expect(await pagedShopActivity(db, OTHER_SHOP, { actorPersonId: owner.id })).toMatchObject({
      total: 0,
      rows: [],
    });
  });

  it("offers the shop's staff, and nobody else, as the people to filter by", async () => {
    const { db, shop } = ctx;
    const staff = await listStaff(db, shop.id);
    const offered = await listShopActivityPeople(db, shop.id);
    expect(offered.length).toBeGreaterThan(0);
    expect(new Set(offered.map((person) => person.id))).toEqual(
      new Set(staff.map((member) => member.person.id)),
    );
    expect(await listShopActivityPeople(db, OTHER_SHOP)).toEqual([]);
  });
});

/**
 * **A deleted diver's name never comes back through the log.** The lines this
 * module writes carry the handle the erasure sweeps by, so after
 * `anonymizeDiver` the whole log — every trail, every name joined — holds the
 * name nowhere.
 */
describe("erasure", () => {
  it("leaves no trace of an erased diver's name anywhere in the log", async () => {
    const { db, shop } = ctx;
    const { seat, owner } = await bookedSeat(db, shop.id);
    const name = seat.person.fullName;

    for (const code of ["seat_refunded", "payment_marked_refunded"] as const) {
      await recordShopActivity(db, {
        shopId: shop.id,
        actorPersonId: owner.id,
        write: { code, bookingId: seat.booking.id },
      });
    }
    const before = await pagedShopActivity(db, shop.id, {}, { pageSize: 500 });
    expect(JSON.stringify(before.rows)).toContain(name);

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: seat.person.id,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);

    const after = await pagedShopActivity(db, shop.id, {}, { pageSize: 500 });
    expect(after.total).toBe(before.total);
    expect(JSON.stringify(after.rows)).not.toContain(name);
    const theirs = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.bookingId, seat.booking.id));
    for (const row of theirs) expect(row).toMatchObject(ACTIVITY_REDACTED);
  });
});
