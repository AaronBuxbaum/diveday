import { issueBookingCapability } from "../../db/booking-capabilities";
import { createBooking } from "../../db/bookings";
import type { AppDb } from "../../db/client";
import { createTrip } from "../../db/trips";
import { HOUR_MS } from "../../lib/clock";

/** Two real capabilities for the same seat: the delivered link and the booking redirect. */
export async function seedDiverPhotoReadiness(db: AppDb, shopId: string, now: Date) {
  const trip = await createTrip(db, {
    shopId,
    title: "Photo readiness reef",
    capacity: 6,
    plannedDives: 1,
    startsAt: new Date(now.getTime() + 72 * HOUR_MS),
    endsAt: new Date(now.getTime() + 76 * HOUR_MS),
  });
  if (!trip) throw new Error("photo fixture trip missing");
  const booking = await createBooking(db, {
    actor: "staff",
    shopId,
    tripId: trip.id,
    fullName: "Taylor Reed",
    email: "taylor-photo@example.com",
  });
  if (!booking.ok) throw new Error("photo fixture booking missing");
  const delivered = await issueBookingCapability(db, {
    shopId,
    bookingId: booking.bookingId,
    purpose: "readiness",
    delivered: true,
  });
  const redirect = await issueBookingCapability(db, {
    shopId,
    bookingId: booking.bookingId,
    purpose: "readiness",
  });
  if (!delivered || !redirect) throw new Error("photo fixture links missing");
  return { delivered: delivered.token, redirect: redirect.token };
}
