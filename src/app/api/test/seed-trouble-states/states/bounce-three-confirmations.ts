import { and, eq, gte, isNull } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { recordNotificationDelivery } from "@/db/notifications";
import { bookings, people, trips } from "@/db/schema";

/**
 * Three booking confirmations on the next departure that never arrived, so
 * Today's one batched email row has something to batch (Aaron, 2026-10-05:
 * "when emails fail to send to multiple people, it should be batched into a
 * single row"). Chosen by the diver's name, for the same reason
 * `boardADiverThenBlockThem` is: seeded names do not move between runs.
 */
export async function bounceThreeConfirmations(
  db: AppDb,
  shopId: string,
  now: Date,
): Promise<void> {
  const [next] = await db
    .select({ id: trips.id })
    .from(trips)
    .innerJoin(bookings, eq(bookings.tripId, trips.id))
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        isNull(trips.deletedAt),
        gte(trips.startsAt, now),
        eq(bookings.status, "booked"),
      ),
    )
    .orderBy(trips.startsAt)
    .limit(1);
  if (!next) return;
  const roster = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(eq(bookings.shopId, shopId), eq(bookings.tripId, next.id), eq(bookings.status, "booked")),
    )
    .orderBy(people.fullName)
    .limit(3);
  for (const booking of roster) {
    await recordNotificationDelivery(db, {
      shopId,
      bookingId: booking.id,
      kind: "booking_confirmation",
      delivery: { status: "failed", detail: "mailbox does not exist" },
    });
  }
}
