import { and, eq, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { hasReturned } from "@/lib/trips";
import { issueCourseFormsCapability } from "./booking-capabilities";
import type { AppDb } from "./client";
import { getCourseFormsForBooking, lockCourseFormSeatRows } from "./course-forms";
import { bookings, trips } from "./schema";
import { liveTrip } from "./trips-live";

/** Issue only the selected live seat's forms capability; callers authenticate staff. */
export async function issueCounterCourseForms(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    bookingId: string;
    now?: Date;
  },
): Promise<{ token: string; expiresAt: Date } | null> {
  return db.transaction(async (tx) => {
    // Lock trips in the same order as seat moves, then both relevant seats.
    const lockedSeat = await lockCourseFormSeatRows(tx, input.shopId, input.bookingId);
    if (!lockedSeat) return null;
    const [seat] = await tx
      .select({ id: bookings.id, endsAt: trips.endsAt })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          eq(bookings.tripId, input.tripId),
          eq(trips.shopId, input.shopId),
          liveTrip(),
          ne(trips.status, "cancelled"),
          ne(bookings.status, "cancelled"),
        ),
      )
      .limit(1);
    if (!seat) return null;
    const now = input.now ?? nowDate();
    if (hasReturned(seat.endsAt, now)) return null;
    const forms = await getCourseFormsForBooking(tx, input.shopId, seat.id, now);
    if (
      !forms ||
      forms.enrollment.identityHeld ||
      hasReturned(forms.enrollment.endsAt, now) ||
      !forms.outstanding.length
    )
      return null;
    return issueCourseFormsCapability(tx, {
      shopId: input.shopId,
      bookingId: seat.id,
      expectedPersonId: lockedSeat.personId,
      now,
    });
  });
}
