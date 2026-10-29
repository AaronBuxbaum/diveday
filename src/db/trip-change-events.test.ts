import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { listTripChangeEvents, recordTripChangeEvent } from "./trip-change-events";
import { createTrip } from "./trips";

const ctx = fileScopedShopContext();

describe("trip change events", () => {
  it("can limit the ledger to changes made since a diver booked", async () => {
    const { db, shop } = ctx;
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Two-Tank Reef — booking-time ledger",
      startsAt: new Date("2030-08-10T13:00:00.000Z"),
      endsAt: new Date("2030-08-10T17:00:00.000Z"),
      capacity: 10,
    });
    if (!trip) throw new Error("trip not created");

    const bookedAt = new Date("2030-08-01T12:00:00.000Z");
    await recordTripChangeEvent(db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "site_change",
      source: "shop",
      beforeValue: { siteNames: null },
      afterValue: { siteNames: "Molasses Reef" },
      occurredAt: new Date("2030-07-31T12:00:00.000Z"),
    });
    await recordTripChangeEvent(db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "site_change",
      source: "shop",
      beforeValue: { siteNames: "Molasses Reef" },
      afterValue: { siteNames: "French Reef" },
      occurredAt: new Date("2030-08-02T12:00:00.000Z"),
    });

    const publicHistory = await listTripChangeEvents(db, shop.id, trip.id);
    const diverThread = await listTripChangeEvents(db, shop.id, trip.id, bookedAt);

    expect(publicHistory).toHaveLength(2);
    expect(diverThread.map((event) => event.afterValue.siteNames)).toEqual(["French Reef"]);
  });
});
