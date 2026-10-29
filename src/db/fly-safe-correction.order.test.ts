import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { listShopFlySafeFollowUps, recordFlySafeTold } from "./fly-safe-correction";
import { bookings } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();

describe("shopwide flying guidance follow-up order", () => {
  it("orders by trip time, diver name, then booking id", async () => {
    const { db, shop } = ctx;
    const scheduled = (await upcomingTripsWithCounts(db, shop.id, nowDate()))
      .filter((trip) => trip.status === "scheduled")
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const firstTrip = scheduled.find((trip) => trip.capacity - trip.booked >= 3);
    const laterTrip = scheduled.find(
      (trip) => firstTrip && trip.startsAt > firstTrip.startsAt && trip.booked < trip.capacity,
    );
    if (!firstTrip || !laterTrip) throw new Error("expected two available scheduled demo trips");

    const createFollowUp = async (tripId: string, name: string, email: string) => {
      const party = await createBookingParty(db, [
        { actor: "staff", shopId: shop.id, tripId, fullName: name, email },
      ]);
      if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
      const bookingId = party.bookings[0].bookingId;
      expect(
        await recordFlySafeTold(db, {
          shopId: shop.id,
          bookingId,
          hours: 24,
          recipientEmail: email,
        }),
      ).toBe(true);
      await db
        .update(bookings)
        .set({ flySafeRecipientUnknown: true })
        .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shop.id)));
      return bookingId;
    };

    // Insert the later trip first and the same-trip names in reverse display order.
    const laterId = await createFollowUp(laterTrip.id, "Aaron Diver", "flysafe-aaron@example.com");
    const queueId = await createFollowUp(firstTrip.id, "Queue Diver", "flysafe-queue@example.com");
    const contactIdA = await createFollowUp(
      firstTrip.id,
      "Contact Diver",
      "flysafe-contact-a@example.com",
    );
    const contactIdB = await createFollowUp(
      firstTrip.id,
      "Contact Diver",
      "flysafe-contact-b@example.com",
    );
    const contactIds = [contactIdA, contactIdB].sort();

    const followUps = await listShopFlySafeFollowUps(db, { shopId: shop.id });
    expect(
      followUps.map(({ bookingId, name, tripId, status }) => ({ bookingId, name, tripId, status })),
    ).toEqual([
      {
        bookingId: contactIds[0],
        name: "Contact Diver",
        tripId: firstTrip.id,
        status: "follow_up",
      },
      {
        bookingId: contactIds[1],
        name: "Contact Diver",
        tripId: firstTrip.id,
        status: "follow_up",
      },
      { bookingId: queueId, name: "Queue Diver", tripId: firstTrip.id, status: "follow_up" },
      { bookingId: laterId, name: "Aaron Diver", tripId: laterTrip.id, status: "follow_up" },
    ]);
    expect(await listShopFlySafeFollowUps(db, { shopId: shop.id })).toEqual(followUps);
  });
});
