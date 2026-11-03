import { describe, expect, it } from "vitest";
import { inHorizonReadiness } from "@/db/blockers";
import { upsertTripRequirements } from "@/db/readiness";
import { upcomingTripsWithCounts } from "@/db/trips";
import { nowDate } from "@/lib/clock";
import { shopClock } from "@/lib/shop-clock";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import { fileScopedShopContext } from "@/test/db";
import { countBlockedDiversNextBoatDay } from "./index";

const ctx = fileScopedShopContext();

/**
 * Every case reads the clock the seed is anchored to. `new Date(0)` used to
 * work here because the readiness pass had no horizon at all — it does now
 * (the shared one), and 1970 has no departures inside it.
 */
const NOW = nowDate();

/** Blocked bookings on the shop-day `NOW` falls on, the way the badge counts them. */
function blockedToday(
  evidence: Awaited<ReturnType<typeof inHorizonReadiness>>,
  timeZone: string,
): number {
  const day = (date: Date) => toDateInputValue(utcToWallTime(date, timeZone));
  let blocked = 0;
  for (const trip of evidence.trips) {
    if (day(trip.startsAt) !== day(NOW)) continue;
    for (const row of evidence.readinessByTrip.get(trip.id) ?? []) {
      if (row.readiness.status === "blocked") blocked += 1;
    }
  }
  return blocked;
}

describe("in-horizon readiness (in-memory PGlite)", () => {
  it("the badge counts today's blocked divers while today's boats are still to sail (nav badge, UX audit item 1)", async () => {
    const { db, shop } = ctx;
    const expected = blockedToday(await inHorizonReadiness(db, shop.id, NOW), shop.timezone);
    expect(expected).toBeGreaterThan(0);

    const badge = await countBlockedDiversNextBoatDay(db, shop.id, shopClock(shop, NOW));
    expect(badge.day).toBe("today");
    expect(badge.onDay).toBe(expected);
    expect(badge.total).toBe(expected + badge.aboard);
  });
  it("the badge drops when a departure's blockers are cleared", async () => {
    const { db, shop } = ctx;
    const before = await countBlockedDiversNextBoatDay(db, shop.id, shopClock(shop, NOW));
    const trips = await upcomingTripsWithCounts(db, shop.id, NOW);
    const target = trips[0];
    if (!target) throw new Error("expected an upcoming trip");
    await upsertTripRequirements(db, {
      shopId: shop.id,
      tripId: target.id,
      requiresWaiver: false,
      minimumCertificationLevel: null,
      requiredSpecialties: [],
      requiresNitrox: false,
      requiresPayment: false,
    });

    const after = await countBlockedDiversNextBoatDay(db, shop.id, shopClock(shop, NOW));
    expect(after.onDay).toBeLessThanOrEqual(before.onDay);
    expect(after.onDay).toBe(
      blockedToday(await inHorizonReadiness(db, shop.id, NOW), shop.timezone),
    );
  });
});
