// @vitest-environment node
import { describe, expect, it } from "vitest";
import { distinctBlockedDivers } from "@/lib/blockers";
import { nowDate } from "@/lib/clock";
import { operationalWindow } from "@/lib/operational-window";
import { seededShopContext } from "@/test/db";
import { countBlockedDivers, getBlockerQueue } from "./blockers";
import { upsertTripRequirements } from "./readiness";
import { upcomingTripsWithCounts } from "./trips";

/**
 * Every case reads the clock the seed is anchored to. `new Date(0)` used to
 * work here because the queue had no horizon at all — it does now (the shared
 * one), and 1970 has no departures inside it.
 */
const NOW = nowDate();

describe("blocker queue (in-memory PGlite)", () => {
  it("groups blocked divers by upcoming departure with a one-tap fix each", async () => {
    const { db, shop } = await seededShopContext();
    const queue = await getBlockerQueue(db, shop.id, shop.slug, NOW);

    expect(queue.trips.length).toBeGreaterThan(0);
    const withBlockers = queue.trips[0];
    if (!withBlockers) throw new Error("expected a blocked trip");
    expect(withBlockers.divers.length).toBeGreaterThan(0);
    for (const diver of withBlockers.divers) {
      expect(diver.blockers.length).toBeGreaterThan(0);
      expect(diver.fix.href).toContain(`/shop/${shop.slug}/`);
      expect(diver.fix.label).toBeTruthy();
    }
    // Divers are listed alphabetically within a departure.
    const names = withBlockers.divers.map((diver) => diver.fullName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("omits a departure once every booked diver is ready", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id, NOW);
    // Strip every requirement from one trip so its divers are all ready.
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

    const queue = await getBlockerQueue(db, shop.id, shop.slug, NOW);
    expect(queue.trips.some((trip) => trip.tripId === target.id)).toBe(false);
  });

  it("never lists a departure outside the shared operational horizon (task 141)", async () => {
    const { db, shop } = await seededShopContext();
    const { from, to } = operationalWindow(NOW);
    const queue = await getBlockerQueue(db, shop.id, shop.slug, NOW);

    expect(queue.trips.length).toBeGreaterThan(0);
    for (const trip of queue.trips) {
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
    // the window's business (and the shared window note's), not a truncation.
    expect((await getBlockerQueue(db, shop.id, shop.slug, NOW)).truncated).toBe(false);
  });

  it("countBlockedDivers matches the full queue's distinct-diver headline count (nav badge, task 83)", async () => {
    const { db, shop } = await seededShopContext();
    const queue = await getBlockerQueue(db, shop.id, shop.slug, NOW);
    const expected = distinctBlockedDivers(queue.trips);
    expect(expected).toBeGreaterThan(0);

    expect(await countBlockedDivers(db, shop.id, NOW)).toBe(expected);
  });

  it("countBlockedDivers drops when a departure's blockers are cleared, tracking the full queue", async () => {
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
    const queue = await getBlockerQueue(db, shop.id, shop.slug, NOW);
    expect(after).toBe(distinctBlockedDivers(queue.trips));
  });
});
