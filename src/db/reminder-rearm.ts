import { and, eq, inArray, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { TRIP_REMINDER_CADENCES } from "@/lib/reminders";
import type { DbExecutor } from "./client";
import { bookings, notificationDeliveries } from "./schema";

/**
 * **A moved departure re-arms its reminders** (#2444), and so does a moved
 * seat (#2554).
 *
 * The reminder pass dedupes on one `notification_deliveries` row per booking
 * and cadence (`sendDueReminders`), so a diver reminded the night before the
 * old date heard nothing the night before the new one, and that is the
 * message that carries the meeting time. Called inside the transaction that
 * moves the start (`moveTrip`, `editTrip`), whether or not anyone is then
 * told about the move, so an Undo on the reschedule notice cannot leave a
 * diver without the reminder for the date they now sail.
 *
 * The old row is **marked superseded, never deleted** (issue #3705): once
 * `notification_deliveries` is the only record that a message reached a diver,
 * the reminder that was `sent` for the old date is the proof they were told
 * it. `superseded_at` takes the row out of the once-only unique index, so the
 * new date's reminder can take its place, and out of every "already sent" and
 * "latest" read.
 */
export async function rearmTripReminders(
  tx: DbExecutor,
  input: { shopId: string; tripId: string } | { shopId: string; bookingId: string },
): Promise<void> {
  // A whole departure's seats, or one seat that changed departure (a staff
  // move keeps the booking row and changes its trip, issue #2554).
  const seats = tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        "bookingId" in input ? eq(bookings.id, input.bookingId) : eq(bookings.tripId, input.tripId),
      ),
    );
  await tx
    .update(notificationDeliveries)
    .set({ supersededAt: nowDate() })
    .where(
      and(
        isNull(notificationDeliveries.supersededAt),
        eq(notificationDeliveries.shopId, input.shopId),
        inArray(notificationDeliveries.bookingId, seats),
        inArray(
          notificationDeliveries.kind,
          TRIP_REMINDER_CADENCES.map((cadence) => cadence.kind),
        ),
      ),
    );
}
