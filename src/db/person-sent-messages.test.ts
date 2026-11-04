import { describe, expect, it } from "vitest";
import { advanceClock } from "@/test/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { recordNotificationDelivery } from "./notifications";
import { personSentMessages } from "./person-sent-messages";
import { shops } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

/**
 * **What the shop sent a diver** (issue #3660): one line per send, newest first,
 * through the person's own bookings and the shop's scope.
 */
const ctx = fileScopedShopContext();

async function seatFor(email: string) {
  const { db, shop } = ctx;
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("demo trip missing");
  const booking = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Nora Quinn",
    email,
  });
  if (!booking.ok) throw new Error(`booking failed: ${booking.reason}`);
  return { bookingId: booking.bookingId, personId: booking.personId };
}

describe("personSentMessages", () => {
  it("lists each send for the person, newest first, with how it landed", async () => {
    const { db, shop } = ctx;
    const { bookingId, personId } = await seatFor("nora@example.com");
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId,
      kind: "booking_confirmation",
      delivery: { status: "sent", providerMessageId: "m1" },
    });
    advanceClock();
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId,
      kind: "trip_reminder_24h",
      delivery: { status: "failed", errorCode: "bounced" },
    });

    const sent = await personSentMessages(db, shop.id, personId);
    expect(sent.map((row) => [row.kind, row.status])).toEqual([
      ["trip_reminder_24h", "failed"],
      ["booking_confirmation", "sent"],
    ]);
    // No address, subject or provider id rides along.
    expect(Object.keys(sent[0] ?? {}).sort()).toEqual(
      ["attemptedAt", "id", "kind", "providerStatus", "status"].sort(),
    );
  });

  it("lists nothing for another person, and nothing read through another shop", async () => {
    const { db, shop } = ctx;
    const mine = await seatFor("nora@example.com");
    const other = await seatFor("someone.else@example.com");
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId: mine.bookingId,
      kind: "booking_confirmation",
      delivery: { status: "sent", providerMessageId: "m1" },
    });

    expect(await personSentMessages(db, shop.id, other.personId)).toEqual([]);

    const [stranger] = await db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef", timezone: "UTC" })
      .returning();
    if (!stranger) throw new Error("setup: shop missing");
    expect(await personSentMessages(db, stranger.id, mine.personId)).toEqual([]);
  });
});
