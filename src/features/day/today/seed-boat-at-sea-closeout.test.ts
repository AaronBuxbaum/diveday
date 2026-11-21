import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { shops, trips } from "@/db/schema";
import { seedDemo } from "@/db/seed";
import {
  AT_SEA_ABOARD,
  AT_SEA_CREW,
  AT_SEA_DAY_TITLE,
  AT_SEA_DUSK_TITLE,
  AT_SEA_STILL_DOWN,
} from "@/db/seed-boat-at-sea";
import { getShopBySlug } from "@/db/shops";
import { nowDate } from "@/lib/clock";
import { utcToWallTime } from "@/lib/zoned";
import { advanceClock } from "@/test/clock";
import { fileScopedShopContext, unseededTestDb } from "@/test/db";
import { getDayCloseout } from "./index";

/**
 * **The demo has a boat at sea, halfway through her roll call** (market sheet
 * 2026-10-22, item 1): at the frozen 9:30 AM clock she sailed at 6:30, dive 1
 * is counted, and dive 2's count reads nine of eleven back aboard with one
 * buddy pair still down. Every word of the record is behind the clock.
 */

describe("the boat at sea", () => {
  const context = fileScopedShopContext({ history: true });

  async function boatAtSea() {
    const { db, shop } = context;
    const [trip] = await db
      .select()
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.title, AT_SEA_DAY_TITLE)));
    if (!trip) throw new Error("expected the boat at sea");
    return { db, shop, trip };
  }

  it("reads still out at her open dive 2 count today, and loud on the record", async () => {
    const { db, shop, trip } = await boatAtSea();
    const today = await getDayCloseout(db, shop.id, shop.timezone, nowDate());
    expect(today.departures.find((d) => d.tripId === trip.id)).toMatchObject({
      status: "still_out",
      gapReason: null,
      diveNumber: 2,
      uncounted: AT_SEA_STILL_DOWN,
    });
    const record = await getDayCloseout(
      db,
      shop.id,
      shop.timezone,
      nowDate(),
      undefined,
      today.shopDay,
    );
    expect(record.departures.find((d) => d.tripId === trip.id)).toMatchObject({
      status: "unreconciled",
      gapReason: "after_dive_uncounted",
      diveNumber: 2,
    });
  });
  it("shows the finished prior-evening dusk roll call before the dawn boat at 5 AM", async () => {
    const fiveAmOffset = -4.5 * 60 * 60 * 1000; // Fixture clock is 9:30 AM shop time.
    advanceClock(fiveAmOffset);
    const db = await unseededTestDb();
    await seedDemo(db, "history");
    const shop = await getShopBySlug(db, "blue-mantis");
    if (!shop) throw new Error('expected the seeded "blue-mantis" demo shop');
    const now = new Date(nowDate().getTime());

    const state = await getDayCloseout(db, shop.id, shop.timezone, now);
    const dawn = state.departures.find((departure) => {
      const wall = utcToWallTime(departure.startsAt, shop.timezone);
      return wall.hour === 5 && wall.minute === 30;
    });

    expect(state.carryover).toMatchObject({
      title: AT_SEA_DUSK_TITLE,
      status: "all_home",
      sailed: AT_SEA_ABOARD,
      back: AT_SEA_ABOARD,
      crewSailed: AT_SEA_CREW.length,
      crewBack: AT_SEA_CREW.length,
      uncounted: 0,
    });
    expect(state.carryover?.startsAt.getTime()).toBeLessThan(now.getTime());
    expect(state.carryover?.endsAt.getTime()).toBeLessThan(now.getTime());
    expect(dawn).toBeDefined();
    expect(state.carryover?.endsAt.getTime()).toBeLessThan(dawn?.startsAt.getTime() ?? 0);

    await db.update(shops).set({ timezone: "Pacific/Honolulu" }).where(eq(shops.id, shop.id));
    const afterTimezoneEdit = await getDayCloseout(db, shop.id, "Pacific/Honolulu", now);
    expect(
      afterTimezoneEdit.departures.filter(
        (departure) => departure.tripId === state.carryover?.tripId,
      ),
    ).toHaveLength(1);
    expect(
      afterTimezoneEdit.departures.find(
        (departure) => departure.tripId === state.carryover?.tripId,
      ),
    ).toMatchObject({
      status: "all_home",
      title: AT_SEA_DUSK_TITLE,
    });
    expect(afterTimezoneEdit.carryover).toBeUndefined();

    await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));
    expect((await getDayCloseout(db, shop.id, "Pacific/Honolulu", now)).carryover).toBeUndefined();
  });
});
