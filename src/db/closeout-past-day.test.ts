import { describe, expect, it } from "vitest";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowMs } from "@/lib/clock";
import { rollCallCheckpoints } from "@/lib/roll-call";
import { shopDaysBounds } from "@/lib/zoned";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { getDayCloseout } from "./closeout";
import { bookings, people, rollCallEvents, shops, trips } from "./schema";
import { listStaff } from "./trips";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * **A past day, read as it closed** (issue #2662): `getDayCloseout` with a
 * date. Its head counts are a safety reading, so most of these are about what
 * the page must never say: "All home" over a boat whose count is still open,
 * however old the day is.
 */
const ctx = fileScopedShopContext();

/** A one-dive boat that sailed `daysAgo` days back, with one diver counted aboard at the dock. */
async function countedAtTheDock(db: AppDb, shopId: string, daysAgo: number) {
  const [staff] = await listStaff(db, shopId);
  const [diver] = await db.insert(people).values({ shopId, fullName: "Past Diver" }).returning();
  if (!staff || !diver) throw new Error("fixture staff or diver missing");
  const startsAt = new Date(nowMs() - daysAgo * DAY);
  const [trip] = await db
    .insert(trips)
    .values({
      shopId,
      title: "Past Two-Tank",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3 * HOUR),
      capacity: 8,
      plannedDives: 1,
    })
    .returning();
  if (!trip) throw new Error("fixture trip insert returned no row");
  const [booking] = await db
    .insert(bookings)
    .values({
      bookedAs: "diver",
      shopId,
      tripId: trip.id,
      personId: diver.id,
      status: "checked_in",
    })
    .returning();
  if (!booking) throw new Error("fixture booking insert returned no row");
  await db.insert(rollCallEvents).values({
    shopId,
    tripId: trip.id,
    bookingId: booking.id,
    recordedByPersonId: staff.person.id,
    status: "boarded",
    checkpoint: "departure",
    source: "live",
    occurredAt: startsAt,
  });
  const backAboard = (occurredAt: Date) =>
    db.insert(rollCallEvents).values({
      shopId,
      tripId: trip.id,
      bookingId: booking.id,
      recordedByPersonId: staff.person.id,
      status: "boarded",
      checkpoint: rollCallCheckpoints(1).at(-1) ?? "departure",
      source: "live",
      occurredAt,
    });
  return { trip, backAboard };
}

describe("a past day's close-out", () => {
  it("reads that day's departures, on that day, and offers no load-out", async () => {
    const { db, shop } = ctx;
    const { trip } = await countedAtTheDock(db, shop.id, 3);
    const day = calendarDateInTimezone(trip.startsAt, shop.timezone);

    const state = await getDayCloseout(db, shop.id, shop.timezone, undefined, shop, day);

    expect(state.shopDay).toBe(day);
    expect(state.departures.map((departure) => departure.tripId)).toContain(trip.id);
    const { from, to } = shopDaysBounds(day, day, shop.timezone);
    for (const departure of state.departures) {
      expect(departure.startsAt >= from && departure.startsAt < to).toBe(true);
    }
    expect(state.tomorrow).toBeUndefined();
  });

  it("holds a three-day-old count open until somebody closes it", async () => {
    const { db, shop } = ctx;
    const { trip, backAboard } = await countedAtTheDock(db, shop.id, 3);
    const day = calendarDateInTimezone(trip.startsAt, shop.timezone);
    const read = async () =>
      (await getDayCloseout(db, shop.id, shop.timezone, undefined, undefined, day)).departures.find(
        (departure) => departure.tripId === trip.id,
      );

    expect(await read()).toMatchObject({
      status: "unreconciled",
      gapReason: "after_dive_uncounted",
    });
    await backAboard(new Date(trip.endsAt.getTime() - HOUR));
    expect((await read())?.status).toBe("all_home");
  });

  /**
   * The adversarial case. `listRollCallGaps` looks back thirty days from the
   * instant it is asked about; asked about now, a forty-five-day-old boat is
   * outside it, raises no gap, and the clock alone would call it home.
   */
  it("never calls an old boat home while its count is open", async () => {
    const { db, shop } = ctx;
    const { trip, backAboard } = await countedAtTheDock(db, shop.id, 45);
    const day = calendarDateInTimezone(trip.startsAt, shop.timezone);
    const read = async () =>
      (await getDayCloseout(db, shop.id, shop.timezone, undefined, undefined, day)).departures.find(
        (departure) => departure.tripId === trip.id,
      );

    expect(await read()).toMatchObject({
      status: "unreconciled",
      gapReason: "after_dive_uncounted",
    });
    // Closed today, weeks late: the mark still counts on the day it belongs to.
    await backAboard(new Date(nowMs()));
    expect((await read())?.status).toBe("all_home");
  });

  it("reads nothing for a day no boat went out, and never another shop's", async () => {
    const { db, shop } = ctx;
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "past-day-other", timezone: shop.timezone })
      .returning();
    if (!other) throw new Error("other shop insert returned no row");
    const startsAt = new Date(nowMs() - 400 * DAY);
    await db.insert(trips).values({
      shopId: other.id,
      title: "Not ours",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3 * HOUR),
      capacity: 8,
    });
    const day = calendarDateInTimezone(startsAt, shop.timezone);

    const state = await getDayCloseout(db, shop.id, shop.timezone, undefined, undefined, day);

    expect(state.shopDay).toBe(day);
    expect(state.departures).toEqual([]);
  });
});
