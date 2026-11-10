import { and, eq, inArray } from "drizzle-orm";
import { issueBookingCapability } from "../../db/booking-capabilities";
import { createBookingParty, expireGroupHolds } from "../../db/bookings";
import type { AppDb } from "../../db/client";
import { setBookingPayment } from "../../db/payments";
import { bookings } from "../../db/schema";
import { createTrip } from "../../db/trips";
import { HOUR_MS } from "../../lib/clock";

/** Real party/payment transitions, with an explicitly due hold for the expired capture. */
export async function seedGroupHoldLedger(db: AppDb, shopId: string, now: Date, expired = false) {
  const trip = await createTrip(db, {
    shopId,
    title: "Group reef departure",
    capacity: 8,
    plannedDives: 1,
    startsAt: new Date(now.getTime() + 72 * HOUR_MS),
    endsAt: new Date(now.getTime() + 76 * HOUR_MS),
    priceCents: 10_000,
  });
  if (!trip) throw new Error("group departure missing");
  const party = await createBookingParty(
    db,
    [
      {
        actor: "public",
        shopId,
        tripId: trip.id,
        fullName: "Orla Byrne",
        email: "group-organizer@example.com",
      },
      { actor: "public", shopId, tripId: trip.id, fullName: "Sam Reyes" },
      { actor: "public", shopId, tripId: trip.id, fullName: "Maya Alvarez" },
    ],
    { holdUntil: new Date(now.getTime() + 24 * HOUR_MS) },
  );
  if (!party.ok || !party.bookings[0] || !party.bookings[1]) throw new Error("group party missing");
  const lead = party.bookings[0];
  await setBookingPayment(db, {
    shopId,
    bookingId: party.bookings[1].bookingId,
    status: "paid",
    currency: "usd",
    amountCents: 10_000,
  });
  const link = await issueBookingCapability(db, {
    shopId,
    bookingId: lead.bookingId,
    purpose: "readiness",
  });
  if (!link) throw new Error("organizer link missing");
  if (expired) {
    await db
      .update(bookings)
      .set({ groupHoldUntil: now })
      .where(
        and(
          eq(bookings.shopId, shopId),
          inArray(
            bookings.id,
            party.bookings
              .filter((seat) => seat.bookingId !== party.bookings[1]?.bookingId)
              .map((seat) => seat.bookingId),
          ),
        ),
      );
    await expireGroupHolds(db, now);
  }
  return { tripId: trip.id, token: link.token };
}
