import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { type Notification, type NotificationDelivery, notify } from "@/lib/notifications";
import type { AppDb } from "./client";
import { bookings, notificationDeliveries, people, trips } from "./schema";

type RecordNotificationDeliveryInput = {
  shopId: string;
  bookingId: string;
  kind: Notification["kind"];
  delivery: NotificationDelivery;
};

/**
 * Keep the last delivery result for each booking and purpose. The booking
 * check makes the persistence seam tenant-safe even when invoked outside a
 * route action.
 */
export async function recordNotificationDelivery(
  db: AppDb,
  input: RecordNotificationDeliveryInput,
) {
  const [booking] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
    .limit(1);
  if (!booking) return null;

  const values = {
    shopId: input.shopId,
    bookingId: booking.id,
    kind: input.kind,
    status: input.delivery.status,
    providerMessageId: input.delivery.status === "sent" ? input.delivery.providerMessageId : null,
    attemptedAt: new Date(),
  };
  const [record] = await db
    .insert(notificationDeliveries)
    .values(values)
    .onConflictDoUpdate({
      target: [notificationDeliveries.bookingId, notificationDeliveries.kind],
      set: values,
    })
    .returning();
  return record ?? null;
}

/**
 * Outbound email is best-effort, but its latest result is durable enough for
 * staff to notice an issue. A tracking write failure must not alter the
 * booking or waiver operation that triggered it.
 */
export async function sendAndRecordNotification(db: AppDb, input: Notification) {
  let delivery: NotificationDelivery;
  try {
    delivery = await notify(input);
  } catch {
    delivery = { status: "failed" };
  }

  try {
    await recordNotificationDelivery(db, {
      shopId: input.shopId,
      bookingId: input.bookingId,
      kind: input.kind,
      delivery,
    });
  } catch {
    console.error("Notification delivery status could not be recorded", {
      bookingId: input.bookingId,
      kind: input.kind,
    });
  }
  return delivery;
}

/** Open email issues for the staff dashboard; cancelled bookings need no follow-up. */
export async function listNotificationDeliveryIssues(db: AppDb, shopId: string) {
  return db
    .select({
      delivery: notificationDeliveries,
      booking: bookings,
      person: people,
      trip: trips,
    })
    .from(notificationDeliveries)
    .innerJoin(bookings, eq(bookings.id, notificationDeliveries.bookingId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(notificationDeliveries.shopId, shopId),
        inArray(notificationDeliveries.status, ["failed", "not_configured"]),
        ne(bookings.status, "cancelled"),
      ),
    )
    .orderBy(desc(notificationDeliveries.attemptedAt));
}
