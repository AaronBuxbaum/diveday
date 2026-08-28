import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { operationalWindow } from "@/lib/operational-window";
import { seededShopContext } from "@/test/db";
import { countBlockedDivers, inHorizonReadiness } from "./blockers";
import { upsertTripRequirements } from "./readiness";
import { upcomingTripsWithCounts } from "./trips";

/**
 * Every case reads the clock the seed is anchored to. `new Date(0)` used to
 * work here because the readiness pass had no horizon at all — it does now
 * (the shared one), and 1970 has no departures inside it.
 */
const NOW = nowDate();

/** Distinct people still blocked, the way the badge counts them. */
function blockedPeople(evidence: Awaited<ReturnType<typeof inHorizonReadiness>>): Set<string> {
  const people = new Set<string>();
  for (const trip of evidence.trips) {
    for (const row of evidence.readinessByTrip.get(trip.id) ?? []) {
      if (row.readiness.status === "blocked") people.add(row.person.id);
    }
  }
  return people;
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

  it("countBlockedDivers matches the evidence's distinct-diver headline count (nav badge, task 83)", async () => {
    const { db, shop } = await seededShopContext();
    const expected = blockedPeople(await inHorizonReadiness(db, shop.id, NOW)).size;
    expect(expected).toBeGreaterThan(0);

    expect(await countBlockedDivers(db, shop.id, NOW)).toBe(expected);
  });

  it("countBlockedDivers drops when a departure's blockers are cleared", async () => {
    const { db, shop } = await seededShopContext();
    const before = await countBlockedDivers(db, shop.id, NOW);
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

    const after = await countBlockedDivers(db, shop.id, NOW);
    expect(after).toBeLessThanOrEqual(before);
    expect(after).toBe(blockedPeople(await inHorizonReadiness(db, shop.id, NOW)).size);
  });
});
