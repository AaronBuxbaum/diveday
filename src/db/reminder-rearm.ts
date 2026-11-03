import { and, eq, inArray } from "drizzle-orm";
import { TRIP_REMINDER_CADENCES } from "@/lib/reminders";
import type { DbExecutor } from "./client";
import { bookings, notificationDeliveries } from "./schema";

/**
 * **A moved departure re-arms its reminders** (#2444).
 *
 * The reminder pass dedupes on one `notification_deliveries` row per booking
 * and cadence (`sendDueReminders`), so a diver reminded the night before the
 * old date heard nothing the night before the new one, and that is the
 * message that carries the meeting time. Called inside the transaction that
 * moves the start (`moveTrip`, `editTrip`), whether or not anyone is then
 * told about the move, so an Undo on the reschedule notice cannot leave a
 * diver without the reminder for the date they now sail.
 *
 * The rows go rather than being marked: a reminder is a once-only kind
 * (`ONCE_ONLY_DELIVERY_KINDS`), held to one row per booking by a partial unique
 * index, and its row is machinery a staffer never pointed at (ADR
 * 20260820-every-delete-is-soft, "machinery nobody pointed at"). Since issue
 * #2728 dropped the separate attempt trail, the old date's reminder leaves no
 * row behind. The failure this allows is one extra reminder after a small
 * move, never a missing one.
 */
export async function rearmTripReminders(
  tx: DbExecutor,
  input: { shopId: string; tripId: string },
): Promise<void> {
  const seats = tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.shopId, input.shopId), eq(bookings.tripId, input.tripId)));
  await tx.delete(notificationDeliveries).where(
    and(
      eq(notificationDeliveries.shopId, input.shopId),
      inArray(notificationDeliveries.bookingId, seats),
      inArray(
        notificationDeliveries.kind,
        TRIP_REMINDER_CADENCES.map((cadence) => cadence.kind),
      ),
    ),
  );
}
