import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DAY_MS, nowDate } from "@/lib/clock";
import { hasReturned } from "@/lib/trips";
import { fileScopedShopContext } from "@/test/db";
import { returnTheConservationRecap } from "./facts/recap-states";
import { getRecapPageData } from "./recap";
import { bookings, tripConservation, trips } from "./schema";
import { DEMO_RECAP_BOOKING_ID } from "./seed-identifiers";

const ctx = fileScopedShopContext({ history: true });

describe("conservation in the actual recap reader", () => {
  it("seeds only a returned departure, leaving the pinned future boat unannotated", async () => {
    const { db, shop } = ctx;
    const seeded = await db
      .select({ endsAt: trips.endsAt })
      .from(tripConservation)
      .innerJoin(trips, eq(trips.id, tripConservation.tripId))
      .where(eq(tripConservation.shopId, shop.id));
    expect(seeded).toHaveLength(1);
    expect(seeded.every(({ endsAt }) => hasReturned(endsAt, nowDate()))).toBe(true);
    const data = await getRecapPageData(db, DEMO_RECAP_BOOKING_ID);
    expect(data?.conservation).toEqual([]);
  });

  it("publishes a recorded returned fact and uses the recap's injected clock", async () => {
    const { db, shop } = ctx;
    await returnTheConservationRecap(db, shop.id, nowDate());
    const [trip] = await db
      .select({ endsAt: trips.endsAt })
      .from(trips)
      .innerJoin(bookings, eq(bookings.tripId, trips.id))
      .where(and(eq(bookings.id, DEMO_RECAP_BOOKING_ID), eq(trips.shopId, shop.id)));
    if (!trip) throw new Error("Pinned recap departure missing");
    const early = await getRecapPageData(
      db,
      DEMO_RECAP_BOOKING_ID,
      undefined,
      new Date(trip.endsAt.getTime() - 60_000),
    );
    expect(early?.conservation).toEqual([]);
    const returned = await getRecapPageData(
      db,
      DEMO_RECAP_BOOKING_ID,
      undefined,
      new Date(trip.endsAt.getTime() + DAY_MS),
    );
    expect(returned?.conservation).toEqual([
      expect.objectContaining({ kind: "litter_kg", quantity: 1.8, location: "Molasses Reef" }),
    ]);
  });
});
