import { describe, expect, it } from "vitest";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowMs } from "@/lib/clock";
import { rollCallCheckpoints } from "@/lib/roll-call";
import { shopDaysBounds } from "@/lib/zoned";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { getDayCloseout, listNotBackAfterDive } from "./closeout";
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

/**
 * **The review's blocker** (dom-w4-dock B1): `listRollCallGaps` drops the dock
 * count once a trip has been home 48 hours, and drops the trip altogether after
 * thirty days. Either way a past day used to read "All home" over a dock count
 * nobody took. A past day reads every gap of its own boats, however old.
 */
describe("a past day's dock count", () => {
  type Mark = { seat: number; checkpoint: string; status: "boarded" | "not_boarded" };

  /** A boat on the seeded shop (or `shopId`) with `divers` seats and the marks given. */
  async function boat(
    db: AppDb,
    input: {
      shopId: string;
      startsAt: Date;
      hours?: number;
      plannedDives?: number;
      divers?: number;
      marks?: Mark[];
      isRehearsal?: boolean;
    },
  ) {
    const startsAt = input.startsAt;
    const [trip] = await db
      .insert(trips)
      .values({
        shopId: input.shopId,
        title: `Boat ${startsAt.toISOString()}`,
        startsAt,
        endsAt: new Date(startsAt.getTime() + (input.hours ?? 3) * HOUR),
        capacity: 8,
        plannedDives: input.plannedDives ?? 1,
        isRehearsal: input.isRehearsal ?? false,
        isPrivate: input.isRehearsal ?? false,
      })
      .returning();
    if (!trip) throw new Error("fixture trip insert returned no row");
    const seats: string[] = [];
    for (let index = 0; index < (input.divers ?? 1); index += 1) {
      const [diver] = await db
        .insert(people)
        .values({ shopId: input.shopId, fullName: `Diver ${index}` })
        .returning();
      if (!diver) throw new Error("fixture diver insert returned no row");
      const [seat] = await db
        .insert(bookings)
        .values({
          bookedAs: "diver",
          shopId: input.shopId,
          tripId: trip.id,
          personId: diver.id,
          status: "checked_in",
        })
        .returning();
      if (!seat) throw new Error("fixture booking insert returned no row");
      seats.push(seat.id);
    }
    if (input.marks?.length) {
      const [staff] = await listStaff(db, input.shopId);
      if (!staff) throw new Error("fixture staff missing");
      for (const mark of input.marks) {
        await db.insert(rollCallEvents).values({
          shopId: input.shopId,
          tripId: trip.id,
          bookingId: seats[mark.seat] ?? "",
          recordedByPersonId: staff.person.id,
          status: mark.status,
          checkpoint: mark.checkpoint as "departure",
          source: "live",
          occurredAt: startsAt,
        });
      }
    }
    return trip;
  }

  async function station(db: AppDb, shopId: string, timeZone: string, tripId: string, day: string) {
    const state = await getDayCloseout(db, shopId, timeZone, undefined, undefined, day);
    return state.departures.find((departure) => departure.tripId === tripId);
  }

  it.each([3, 5, 29, 30, 31, 45])(
    "reads a %i-day-old boat nobody counted as a count never taken",
    async (daysAgo) => {
      const { db, shop } = ctx;
      const trip = await boat(db, {
        shopId: shop.id,
        startsAt: new Date(nowMs() - daysAgo * DAY),
      });
      const day = calendarDateInTimezone(trip.startsAt, shop.timezone);
      expect(await station(db, shop.id, shop.timezone, trip.id, day)).toMatchObject({
        status: "count_open",
        gapReason: "no_roll_call",
      });
    },
  );

  it("reads a dock count half taken as half taken, days later", async () => {
    const { db, shop } = ctx;
    const trip = await boat(db, {
      shopId: shop.id,
      startsAt: new Date(nowMs() - 5 * DAY),
      divers: 2,
      marks: [
        { seat: 0, checkpoint: "departure", status: "boarded" },
        { seat: 0, checkpoint: "after_dive_1", status: "boarded" },
      ],
    });
    const day = calendarDateInTimezone(trip.startsAt, shop.timezone);
    expect(await station(db, shop.id, shop.timezone, trip.id, day)).toMatchObject({
      status: "count_open",
      gapReason: "departure_uncounted",
      uncounted: 1,
    });
  });

  it("holds a two-dive boat open when only dive 1 was counted", async () => {
    const { db, shop } = ctx;
    const trip = await boat(db, {
      shopId: shop.id,
      startsAt: new Date(nowMs() - 4 * DAY),
      plannedDives: 2,
      marks: [
        { seat: 0, checkpoint: "departure", status: "boarded" },
        { seat: 0, checkpoint: "after_dive_1", status: "boarded" },
      ],
    });
    const day = calendarDateInTimezone(trip.startsAt, shop.timezone);
    expect(await station(db, shop.id, shop.timezone, trip.id, day)).toMatchObject({
      status: "unreconciled",
      gapReason: "after_dive_uncounted",
      diveNumber: 2,
    });
  });

  it("reads a boat on the spring-forward day on that day", async () => {
    const { db, shop } = ctx;
    // 09:00 on 2026-03-08 in New York, the morning the clocks went forward.
    const trip = await boat(db, { shopId: shop.id, startsAt: new Date("2026-03-08T13:00:00Z") });
    expect(shop.timezone).toBe("America/New_York");
    expect(await station(db, shop.id, shop.timezone, trip.id, "2026-03-08")).toMatchObject({
      gapReason: "no_roll_call",
    });
  });

  it("files a 22:00 to 02:00 night boat under the day it left", async () => {
    const { db, shop } = ctx;
    // 22:00 on 2026-07-10 in New York, home at 02:00 on the 11th.
    const trip = await boat(db, {
      shopId: shop.id,
      startsAt: new Date("2026-07-11T02:00:00Z"),
      hours: 4,
    });
    expect(await station(db, shop.id, shop.timezone, trip.id, "2026-07-10")).toMatchObject({
      gapReason: "no_roll_call",
    });
    expect(await station(db, shop.id, shop.timezone, trip.id, "2026-07-11")).toBeUndefined();
  });

  it("reads a shop's day in its own zone, far from New York", async () => {
    const { db } = ctx;
    const [tokyo] = await db
      .insert(shops)
      .values({ name: "Tokyo Shop", slug: "past-day-tokyo", timezone: "Asia/Tokyo" })
      .returning();
    if (!tokyo) throw new Error("shop insert returned no row");
    // 07:00 on 2026-07-02 in Tokyo is still July 1 in UTC and in New York.
    const trip = await boat(db, { shopId: tokyo.id, startsAt: new Date("2026-07-01T22:00:00Z") });
    expect(await station(db, tokyo.id, "Asia/Tokyo", trip.id, "2026-07-02")).toMatchObject({
      gapReason: "no_roll_call",
    });
    expect(await station(db, tokyo.id, "Asia/Tokyo", trip.id, "2026-07-01")).toBeUndefined();
  });

  it("leaves a rehearsal off the day", async () => {
    const { db, shop } = ctx;
    const trip = await boat(db, {
      shopId: shop.id,
      startsAt: new Date(nowMs() - 6 * DAY),
      isRehearsal: true,
    });
    const day = calendarDateInTimezone(trip.startsAt, shop.timezone);
    expect(await station(db, shop.id, shop.timezone, trip.id, day)).toBeUndefined();
  });
});

/**
 * **A diver once recorded not back** (dom-w4-records S1): a mid-day "not back
 * aboard" later settled leaves the station green, so the page names the dive
 * it happened on. Any such mark, superseded or not; a dock mark is not one.
 */
describe("listNotBackAfterDive", () => {
  it("names the first dive a diver was recorded not back on, even once resolved", async () => {
    const { db, shop } = ctx;
    const [staff] = await listStaff(db, shop.id);
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Found" })
      .returning();
    const startsAt = new Date(nowMs() - 2 * DAY);
    const [trip] = await db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Two dives",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * HOUR),
        capacity: 8,
        plannedDives: 2,
      })
      .returning();
    const [quiet] = await db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Quiet",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * HOUR),
        capacity: 8,
      })
      .returning();
    if (!staff || !diver || !trip || !quiet) throw new Error("fixture rows missing");
    const [seat] = await db
      .insert(bookings)
      .values({ bookedAs: "diver", shopId: shop.id, tripId: trip.id, personId: diver.id })
      .returning();
    if (!seat) throw new Error("fixture booking missing");
    const mark = (checkpoint: string, status: "boarded" | "not_boarded", minutes: number) =>
      db.insert(rollCallEvents).values({
        shopId: shop.id,
        tripId: trip.id,
        bookingId: seat.id,
        recordedByPersonId: staff.person.id,
        status,
        checkpoint: checkpoint as "departure",
        source: "live",
        occurredAt: new Date(startsAt.getTime() + minutes * 60_000),
      });
    await mark("departure", "not_boarded", 0);
    await mark("departure", "boarded", 1);
    await mark("after_dive_2", "not_boarded", 200);
    await mark("after_dive_2", "boarded", 210);

    const marks = await listNotBackAfterDive(db, shop.id, [trip.id, quiet.id]);
    expect(marks.get(trip.id)).toBe(2);
    expect(marks.has(quiet.id)).toBe(false);
  });
});
