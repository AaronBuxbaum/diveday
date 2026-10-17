import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { getDayCloseout } from "./closeout";
import { shops, trips } from "./schema";
import { todayNextDepartureTripId } from "./today";
import { listShopDayDepartures } from "./trips-queries";

/**
 * **The two days a year the shop's day is not 24 hours long** (A§4 item 11).
 *
 * The suite's frozen clock (`TEST_FROZEN_CLOCK`, 2026-07-21) keeps every other
 * db test in summer time, so nothing else here ever crosses a clock change.
 * This file moves the clock itself, per case, to the two 2026 changes in
 * `America/New_York`:
 *
 * - **2026-11-01, fall back.** 02:00 EDT becomes 01:00 EST: the day runs 25
 *   hours, from 04:00Z to 05:00Z the next morning, and 01:30 happens twice.
 * - **2026-03-08, spring forward.** 02:00 EST becomes 03:00 EDT: the day runs
 *   23 hours, from 05:00Z to 04:00Z the next morning.
 *
 * Each case asks the three readers that slice "today" — the shop-day list,
 * the command palette's next boat, and the evening close-out — which boats are
 * today's, at a `now` late on the day itself, where a UTC reading would
 * already be tomorrow.
 */

const ZONE = "America/New_York";

const ctx = fileScopedShopContext();

async function newYorkShop(db: AppDb, slug: string) {
  const [shop] = await db
    .insert(shops)
    .values({ name: "Key Largo Divers", slug, timezone: ZONE })
    .returning();
  if (!shop) throw new Error("shop insert failed");
  return shop;
}

async function departure(db: AppDb, shopId: string, title: string, startsAt: string) {
  const starts = new Date(startsAt);
  const [trip] = await db
    .insert(trips)
    .values({
      shopId,
      title,
      startsAt: starts,
      endsAt: new Date(starts.getTime() + 60 * 60 * 1000),
      capacity: 6,
    })
    .returning();
  if (!trip) throw new Error("trip insert failed");
  return trip;
}

/** Freeze the clock at `instant` for one case, so nothing inside reads July. */
function clockAt(instant: string) {
  beforeEach(() => {
    vi.stubEnv("DIVEDAY_CLOCK", instant);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
}

describe("2026-11-01, the 25-hour day (fall back)", () => {
  // 23:30 EST on the 1st, which is already 04:30Z on the 2nd.
  const lateEvening = "2026-11-02T04:30:00.000Z";
  clockAt(lateEvening);

  it("reads the clock it was moved to", () => {
    expect(nowDate().toISOString()).toBe(lateEvening);
  });

  it("counts every boat between the two midnights, the repeated hour included", async () => {
    const { db } = ctx;
    const shop = await newYorkShop(db, "dst-fall-list");
    await departure(db, shop.id, "Eve night dive", "2026-11-01T03:30:00.000Z"); // 23:30 EDT on the 31st
    await departure(db, shop.id, "Owl dive", "2026-11-01T04:30:00.000Z"); // 00:30 EDT
    await departure(db, shop.id, "First 01:30", "2026-11-01T05:30:00.000Z"); // 01:30 EDT
    await departure(db, shop.id, "Second 01:30", "2026-11-01T06:30:00.000Z"); // 01:30 EST
    await departure(db, shop.id, "Late night dive", "2026-11-02T04:00:00.000Z"); // 23:00 EST
    await departure(db, shop.id, "Next day owl", "2026-11-02T05:30:00.000Z"); // 00:30 EST on the 2nd

    const today = await listShopDayDepartures(db, shop.id, ZONE, nowDate());

    expect(today.map((trip) => trip.title)).toEqual([
      "Owl dive",
      "First 01:30",
      "Second 01:30",
      "Late night dive",
    ]);
  });

  it("offers tonight's boat as today's, not tomorrow's", async () => {
    const { db } = ctx;
    const shop = await newYorkShop(db, "dst-fall-next");
    const tonight = await departure(db, shop.id, "Late night dive", "2026-11-02T04:00:00.000Z");
    await departure(db, shop.id, "Next day owl", "2026-11-02T05:30:00.000Z");

    expect(await todayNextDepartureTripId(db, shop.id, ZONE, nowDate())).toBe(tonight.id);
  });

  it("closes out the 1st, with the 23:00 boat on the sheet", async () => {
    const { db } = ctx;
    const shop = await newYorkShop(db, "dst-fall-close");
    await departure(db, shop.id, "Owl dive", "2026-11-01T04:30:00.000Z");
    await departure(db, shop.id, "Late night dive", "2026-11-02T03:00:00.000Z"); // 22:00 EST
    await departure(db, shop.id, "Next day owl", "2026-11-02T05:30:00.000Z");

    const close = await getDayCloseout(db, shop.id, ZONE, nowDate());

    expect(close.shopDay).toBe("2026-11-01");
    expect(close.departures.map((trip) => trip.title).sort()).toEqual([
      "Late night dive",
      "Owl dive",
    ]);
  });
});

describe("2026-03-08, the 23-hour day (spring forward)", () => {
  // 23:30 EDT on the 8th, which is already 03:30Z on the 9th.
  const lateEvening = "2026-03-09T03:30:00.000Z";
  clockAt(lateEvening);

  it("counts the boats between the two midnights of the short day", async () => {
    const { db } = ctx;
    const shop = await newYorkShop(db, "dst-spring-list");
    await departure(db, shop.id, "Eve night dive", "2026-03-08T04:30:00.000Z"); // 23:30 EST on the 7th
    await departure(db, shop.id, "Owl dive", "2026-03-08T05:30:00.000Z"); // 00:30 EST
    await departure(db, shop.id, "Late night dive", "2026-03-09T03:00:00.000Z"); // 23:00 EDT
    await departure(db, shop.id, "Next day owl", "2026-03-09T04:30:00.000Z"); // 00:30 EDT on the 9th

    const today = await listShopDayDepartures(db, shop.id, ZONE, nowDate());

    expect(today.map((trip) => trip.title)).toEqual(["Owl dive", "Late night dive"]);
  });

  it("offers tonight's boat as today's, not tomorrow's", async () => {
    const { db } = ctx;
    const shop = await newYorkShop(db, "dst-spring-next");
    const tonight = await departure(db, shop.id, "Late night dive", "2026-03-09T03:00:00.000Z");
    await departure(db, shop.id, "Next day owl", "2026-03-09T04:30:00.000Z");

    expect(await todayNextDepartureTripId(db, shop.id, ZONE, nowDate())).toBe(tonight.id);
  });

  it("closes out the 8th", async () => {
    const { db } = ctx;
    const shop = await newYorkShop(db, "dst-spring-close");
    await departure(db, shop.id, "Late night dive", "2026-03-09T02:00:00.000Z"); // 22:00 EDT
    await departure(db, shop.id, "Next day owl", "2026-03-09T04:30:00.000Z");

    const close = await getDayCloseout(db, shop.id, ZONE, nowDate());

    expect(close.shopDay).toBe("2026-03-08");
    expect(close.departures.map((trip) => trip.title)).toEqual(["Late night dive"]);
  });
});
