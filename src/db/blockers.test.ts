import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { operationalWindow } from "@/lib/operational-window";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import { seededShopContext } from "@/test/db";
import { countBlockedDiversToday, inHorizonReadiness } from "./blockers";
import { upsertTripRequirements } from "./readiness";
import { upcomingTripsWithCounts } from "./trips";

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
  it("never inspects a departure outside the shared operational horizon (task 141)", async () => {
    const { db, shop } = await seededShopContext();
    const { from, to } = operationalWindow(NOW);
    const evidence = await inHorizonReadiness(db, shop.id, NOW);

    expect(evidence.trips.length).toBeGreaterThan(0);
    for (const trip of evidence.trips) {
      expect(trip.startsAt.getTime()).toBeGreaterThanOrEqual(from.getTime());
      expect(trip.startsAt.getTime()).toBeLessThanOrEqual(to.getTime());
    }
    // The seeded shop schedules well past the horizon, so this is a real cut,
    // not a window that happens to contain everything.
    const all = await upcomingTripsWithCounts(db, shop.id, NOW);
    expect(all.some((trip) => trip.startsAt.getTime() > to.getTime())).toBe(true);
  });

  it("stays inside the horizon rather than flagging the tail as truncated", async () => {
    const { db, shop } = await seededShopContext();
    // The demo shop has far fewer than `OPERATIONAL_MAX_TRIPS` departures in a
    // week, so the work bound never fires: departures beyond the horizon are
    // the window's business, not a truncation.
    expect((await inHorizonReadiness(db, shop.id, NOW)).truncated).toBe(false);
  });

  it("countBlockedDiversToday counts today's blocked divers only (nav badge, UX audit item 1)", async () => {
    const { db, shop } = await seededShopContext();
    const expected = blockedToday(await inHorizonReadiness(db, shop.id, NOW), shop.timezone);
    expect(expected).toBeGreaterThan(0);

    expect(await countBlockedDiversToday(db, shop.id, shop.timezone, NOW)).toBe(expected);
  });

  it("countBlockedDiversToday drops when a departure's blockers are cleared", async () => {
    const { db, shop } = await seededShopContext();
    const before = await countBlockedDiversToday(db, shop.id, shop.timezone, NOW);
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

    const after = await countBlockedDiversToday(db, shop.id, shop.timezone, NOW);
    expect(after).toBeLessThanOrEqual(before);
    expect(after).toBe(blockedToday(await inHorizonReadiness(db, shop.id, NOW), shop.timezone));
  });
});
