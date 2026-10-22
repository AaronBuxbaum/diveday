import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { utcToWallTime } from "@/lib/zoned";
import { seededShopContext } from "@/test/db";
import { trips } from "./schema";
import { DEMO_SHOP_TIMEZONE, demoTodayDepartureStart } from "./seed-clock";

/**
 * **No demo day boat leaves at an hour no dive shop's day boat does** (issue
 * #2440). Screenshots showed departures at 11:30 PM: today's boat, seeded in
 * the shop's evening, could only sail late. A boat sailing outside 5 AM to
 * 8 PM shop time is a night dive, and says so in its name; the demo seeds
 * none that late.
 */
const DAY_OPENS_MINUTE = 5 * 60;
const DAY_CLOSES_MINUTE = 20 * 60;

describe("the demo's departure hours", () => {
  it("sails every day boat between 5 AM and 8 PM shop time, history included", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const rows = await db
      .select({ title: trips.title, startsAt: trips.startsAt })
      .from(trips)
      .where(eq(trips.shopId, shop.id));
    expect(rows.length).toBeGreaterThan(10);
    const outsideTheDay = rows.filter((row) => {
      if (row.title.startsWith("Night Dive")) return false;
      const wall = utcToWallTime(row.startsAt, DEMO_SHOP_TIMEZONE);
      const minute = wall.hour * 60 + wall.minute;
      return minute < DAY_OPENS_MINUTE || minute > DAY_CLOSES_MINUTE;
    });
    expect(outsideTheDay).toEqual([]);
  });

  it("never puts the readiness departure after the day boats, whatever hour the demo is seeded", () => {
    // Market sheet 2026-10-22, item 1: seeded in the evening, it read
    // "11:30 PM – 3:00 AM" on the public page. It sails tomorrow morning instead.
    for (let quarter = 0; quarter < 96; quarter++) {
      const now = new Date(Date.UTC(2026, 9, 22, 4) + quarter * 15 * 60_000);
      const wall = utcToWallTime(demoTodayDepartureStart(now), DEMO_SHOP_TIMEZONE);
      const minute = wall.hour * 60 + wall.minute;
      expect(minute, now.toISOString()).toBeGreaterThanOrEqual(DAY_OPENS_MINUTE);
      expect(minute, now.toISOString()).toBeLessThanOrEqual(DAY_CLOSES_MINUTE);
    }
  });
});
