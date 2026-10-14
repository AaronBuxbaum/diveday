import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { utcToWallTime } from "@/lib/zoned";
import { seededShopContext } from "@/test/db";
import { trips } from "./schema";
import { DEMO_SHOP_TIMEZONE, DEMO_TODAY_DEPARTURE_MS, demoTodayDepartureStart } from "./seed-clock";
import { DEMO_TODAY_TRIP_TITLE, nameDemoNightDeparture } from "./seed-trips";

/**
 * **No demo day boat leaves at an hour no dive shop's day boat does** (issue
 * #2440). Screenshots showed departures at 11:30 PM: today's boat, seeded in
 * the shop's evening, could only sail late. A boat sailing outside 5 AM to
 * 8 PM shop time is a night dive, and says so in its name.
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

  it("names today's boat as a night dive when an evening seed puts it after 8 PM", async () => {
    const { db, shop } = await seededShopContext();
    const today = demoTodayDepartureStart();
    // The 11:30 PM slot an evening seed falls back to, on the frozen day.
    const wall = utcToWallTime(today, DEMO_SHOP_TIMEZONE);
    const late = new Date(today.getTime() + ((23 - wall.hour) * 60 + (30 - wall.minute)) * 60_000);
    await db
      .update(trips)
      .set({ startsAt: late, endsAt: new Date(late.getTime() + DEMO_TODAY_DEPARTURE_MS) })
      .where(
        and(
          eq(trips.shopId, shop.id),
          eq(trips.startsAt, today),
          eq(trips.title, DEMO_TODAY_TRIP_TITLE),
        ),
      );

    await nameDemoNightDeparture(db, shop.id, late);

    const [boat] = await db
      .select({ title: trips.title })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.startsAt, late)));
    expect(boat?.title).toBe("Night Dive — Molasses & French");
  });

  it("leaves a day-time boat its day name", async () => {
    const { db, shop } = await seededShopContext();
    const today = demoTodayDepartureStart();

    await nameDemoNightDeparture(db, shop.id, today);

    const [boat] = await db
      .select({ title: trips.title })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.startsAt, today)));
    expect(boat?.title).toBe(DEMO_TODAY_TRIP_TITLE);
  });
});
