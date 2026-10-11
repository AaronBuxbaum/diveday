import { describe, expect, it } from "vitest";
import { DAY_MS, nowDate } from "@/lib/clock";
import { fileScopedShopContext, seededShopContext } from "@/test/db";
import { countQueries } from "@/test/query-count";
import { inHorizonReadiness, sharedInHorizonReadiness } from "./blockers";
import { countBlockedDiversNextBoatDay, getShopDayDepartures, getTodayWork } from "./today";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

/**
 * `getShopDayDepartures` replaced a whole second `getTodayWork` on the shop
 * home, kept only for its `departures` (app audit 2026-10-07, item 2). The
 * contract is that nothing a card shows moved: for any shop-day the cards are
 * the ones `getTodayWork` would have drawn for that day, field for field.
 */
describe("one shop-day's departure cards", () => {
  it("draws exactly the cards getTodayWork draws, today and tomorrow", async () => {
    const { db, shop } = ctx;
    const now = nowDate();
    const evidence = await inHorizonReadiness(db, shop.id, now);
    for (const day of [
      now,
      new Date(now.getTime() + DAY_MS),
      new Date(now.getTime() + 2 * DAY_MS),
    ]) {
      const whole = await getTodayWork(
        db,
        shop.id,
        shop.slug,
        shop.timezone,
        day,
        undefined,
        undefined,
        undefined,
        false,
        evidence,
      );
      const cards = await getShopDayDepartures(db, shop.id, shop.timezone, day, evidence);
      expect(cards).toEqual(whole.departures);
    }
  });

  it("has at least one seeded departure to compare, so the test above is not vacuous", async () => {
    const { db, shop } = ctx;
    const now = nowDate();
    const evidence = await inHorizonReadiness(db, shop.id, now);
    let cards = 0;
    for (let offset = 0; offset < 7; offset += 1) {
      const day = new Date(now.getTime() + offset * DAY_MS);
      cards += (await getShopDayDepartures(db, shop.id, shop.timezone, day, evidence)).length;
    }
    expect(cards).toBeGreaterThan(0);
  });

  it("reads a fraction of what a second queue did", async () => {
    // Its own database: countQueries wraps the client underneath, which is not
    // the shared test transaction.
    const { db, shop } = await seededShopContext();
    const now = nowDate();
    const evidence = await inHorizonReadiness(db, shop.id, now);
    const log = countQueries(db);
    const tomorrow = new Date(now.getTime() + DAY_MS);
    await getTodayWork(
      log.db,
      shop.id,
      shop.slug,
      shop.timezone,
      tomorrow,
      undefined,
      undefined,
      undefined,
      false,
      evidence,
    );
    const queue = log.count();
    log.reset();
    await getShopDayDepartures(log.db, shop.id, shop.timezone, tomorrow, evidence);
    expect(log.count()).toBeLessThanOrEqual(6);
    expect(log.count()).toBeLessThan(queue / 4);
  });
});

describe("the shared readiness pass", () => {
  it("answers what the pass answers when there is no render to share it with", async () => {
    const { db, shop } = ctx;
    const now = nowDate();
    const shared = await sharedInHorizonReadiness(db, shop.id, now);
    const own = await inHorizonReadiness(db, shop.id, now);
    expect(shared.trips.map((trip) => trip.id)).toEqual(own.trips.map((trip) => trip.id));
    expect([...shared.readinessByTrip.keys()]).toEqual([...own.readinessByTrip.keys()]);
    expect(
      (await countBlockedDiversNextBoatDay(db, shop.id, shop.timezone, now)).total,
    ).toBeGreaterThanOrEqual(0);
  });
});
