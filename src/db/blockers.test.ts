// @vitest-environment node
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { getBlockerQueue } from "./blockers";
import { upsertTripRequirements } from "./readiness";
import { upcomingTripsWithCounts } from "./trips";

describe("blocker queue (in-memory PGlite)", () => {
  it("groups blocked divers by upcoming departure with a one-tap fix each", async () => {
    const { db, shop } = await seededShopContext();
    const queue = await getBlockerQueue(db, shop.id, shop.slug, new Date(0));

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
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
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

    const queue = await getBlockerQueue(db, shop.id, shop.slug, new Date(0));
    expect(queue.trips.some((trip) => trip.tripId === target.id)).toBe(false);
  });
});
