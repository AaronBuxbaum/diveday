import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { getDayCloseout, readDayLoadOut } from "./closeout";
import { trips } from "./schema";
import { getTripPrep, listShopDayDepartures } from "./trips";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/** Tomorrow from tonight (fifth-loop ideas, item 2): the day's boats, as each Gear tab counts them. */
describe("readDayLoadOut (in-memory PGlite)", () => {
  it("adds each departure's own tank tiles, and says nothing for an empty day", async () => {
    const { db, shop } = ctx;
    const [first] = await db
      .select({ startsAt: trips.startsAt })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.status, "scheduled")))
      .limit(1);
    if (!first) throw new Error("demo trip missing");
    const now = new Date(nowMs());
    const departures = await listShopDayDepartures(db, shop.id, shop.timezone, first.startsAt);
    let total = 0;
    for (const departure of departures) {
      total += (await getTripPrep(db, shop, departure.id, now))?.checklist.tanks.total ?? 0;
    }
    const loadOut = await readDayLoadOut(db, shop, first.startsAt, now);
    expect(loadOut?.departures).toBe(departures.length);
    expect(loadOut?.tanks.total).toBe(total);
    expect(await readDayLoadOut(db, shop, new Date("2001-01-01T12:00:00Z"), now)).toBeNull();
  });

  it("is not read while a boat today is still out", async () => {
    const { db, shop } = ctx;
    // The seed always has a boat sailing today, so mid-morning the day is not closing.
    const midMorning = new Date(nowMs() + 60 * 60 * 1000);
    const state = await getDayCloseout(db, shop.id, shop.timezone, midMorning, shop);
    expect(state.tomorrow).toBeUndefined();
  });
});
