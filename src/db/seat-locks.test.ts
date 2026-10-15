import { describe, expect, it } from "vitest";
import { HOUR_MS } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import type { AppDb } from "./client";
import { shops } from "./schema";
import { lockSeatDeparture } from "./seat-locks";
import { createTrip } from "./trips";

/**
 * `lockSeatDeparture` is the lock order five call sites depend on against the
 * #2324 deadlock (two in `check-in.ts`, two in `no-show.ts`, one in
 * `manifests.ts`): **the departure, then the seat**. `seat-lock-order.postgres.test.ts` races those
 * callers; this file pins the helper itself, and `seat-locks.postgres.test.ts`
 * shows the order holding on a real server.
 */

async function seatOn(db: AppDb, shopId: string) {
  const startsAt = new Date(Date.UTC(2031, 4, 12, 13));
  const trip = await createTrip(db, {
    shopId,
    title: "Seat lock",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
    capacity: 6,
  });
  if (!trip) throw new Error("trip not created");
  const party = await createBookingParty(db, [
    { actor: "staff" as const, shopId, tripId: trip.id, fullName: "Lock Diver" },
  ]);
  if (!party.ok) throw new Error(`seat refused: ${party.reason}`);
  return { tripId: trip.id, bookingId: party.bookings[0].bookingId };
}

describe("lockSeatDeparture", () => {
  const ctx = fileScopedShopContext();

  it("returns the departure the seat is on", async () => {
    const { db, shop } = ctx;
    const seat = await seatOn(db, shop.id);
    expect(await lockSeatDeparture(db, shop.id, seat.bookingId)).toBe(seat.tripId);
  });

  it("finds no seat in another shop, and none that does not exist", async () => {
    const { db, shop } = ctx;
    const seat = await seatOn(db, shop.id);
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef-seat-locks", timezone: "UTC" })
      .returning();
    if (!other) throw new Error("other shop insert failed");
    expect(await lockSeatDeparture(db, other.id, seat.bookingId)).toBeNull();
    expect(await lockSeatDeparture(db, shop.id, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});
