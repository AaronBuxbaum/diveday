import { issueBookingCapability } from "@/db/booking-capabilities";
import type { getBookingForTrip } from "@/db/bookings";
import type { AppDb } from "@/db/client";

export async function issueConfirmedBookingCapability(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    tripId: string;
    expectedPersonId: string | undefined;
    confirmedBooking: Awaited<ReturnType<typeof getBookingForTrip>>;
    purpose: "readiness" | "confirm";
  },
) {
  if (
    !input.expectedPersonId ||
    !input.confirmedBooking ||
    input.confirmedBooking.booking.personId !== input.expectedPersonId ||
    input.confirmedBooking.booking.tripId !== input.tripId
  )
    return null;
  return issueBookingCapability(db, {
    shopId: input.shopId,
    bookingId: input.bookingId,
    purpose: input.purpose,
    expectedPersonId: input.expectedPersonId,
    expectedTripId: input.tripId,
  });
}
