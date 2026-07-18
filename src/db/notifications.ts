import { and, asc, count, desc, eq, inArray, ne } from "drizzle-orm";
import { type Notification, type NotificationDelivery, notify } from "@/lib/notifications";
import type { AppDb } from "./client";
import {
  bookings,
  notificationDeliveries,
  notificationDeliveryAttempts,
  people,
  shops,
  trips,
} from "./schema";

type RecordNotificationDeliveryInput = {
  shopId: string;
  bookingId: string;
  kind: Notification["kind"];
  delivery: NotificationDelivery;
  isRetry?: boolean;
};

/**
 * Keep the last delivery result for each booking and purpose, and append the
 * attempt to the durable history. The booking check makes the persistence seam
 * tenant-safe even when invoked outside a route action.
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

  const attemptedAt = new Date();
  const providerMessageId =
    input.delivery.status === "sent" ? input.delivery.providerMessageId : null;
  const latest = {
    shopId: input.shopId,
    bookingId: booking.id,
    kind: input.kind,
    status: input.delivery.status,
    providerMessageId,
    attemptedAt,
  };
  const [record] = await db
    .insert(notificationDeliveries)
    .values(latest)
    .onConflictDoUpdate({
      target: [notificationDeliveries.bookingId, notificationDeliveries.kind],
      set: latest,
    })
    .returning();
  // Append-only history: never fails the caller, but records every attempt.
  await db.insert(notificationDeliveryAttempts).values({
    shopId: input.shopId,
    bookingId: booking.id,
    kind: input.kind,
    status: input.delivery.status,
    providerMessageId,
    isRetry: input.isRetry ?? false,
    attemptedAt,
  });
  return record ?? null;
}

/**
 * Outbound email is best-effort, but its latest result is durable enough for
 * staff to notice an issue. A tracking write failure must not alter the
 * booking or waiver operation that triggered it.
 */
export async function sendAndRecordNotification(
  db: AppDb,
  input: Notification,
  options: { isRetry?: boolean } = {},
) {
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
      isRetry: options.isRetry,
    });
  } catch {
    console.error("Notification delivery status could not be recorded", {
      bookingId: input.bookingId,
      kind: input.kind,
    });
  }
  return delivery;
}

/**
 * Re-send a booking confirmation from stored booking/trip/shop data. Only
 * confirmations are retryable: a waiver link's one-time token is never stored,
 * so re-sending a waiver means issuing a fresh link, not a retry.
 */
export async function retryBookingConfirmation(db: AppDb, shopId: string, bookingId: string) {
  const [row] = await db
    .select({ booking: bookings, person: people, trip: trips, shop: shops })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.shopId, shopId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .limit(1);
  if (!row?.person.email) return null;
  return sendAndRecordNotification(
    db,
    {
      kind: "booking_confirmation",
      bookingId: row.booking.id,
      shopId,
      to: row.person.email,
      diverName: row.person.fullName,
      shopName: row.shop.name,
      tripTitle: row.trip.title,
      startsAt: row.trip.startsAt,
      endsAt: row.trip.endsAt,
      timezone: row.shop.timezone,
    },
    { isRetry: true },
  );
}

/** Open email issues for the staff dashboard; cancelled bookings need no follow-up. */
export async function listNotificationDeliveryIssues(db: AppDb, shopId: string) {
  return db
    .select({
      delivery: notificationDeliveries,
      booking: bookings,
      person: people,
      trip: trips,
      attempts: count(notificationDeliveryAttempts.id),
    })
    .from(notificationDeliveries)
    .innerJoin(bookings, eq(bookings.id, notificationDeliveries.bookingId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .leftJoin(
      notificationDeliveryAttempts,
      and(
        eq(notificationDeliveryAttempts.bookingId, notificationDeliveries.bookingId),
        eq(notificationDeliveryAttempts.kind, notificationDeliveries.kind),
      ),
    )
    .where(
      and(
        eq(notificationDeliveries.shopId, shopId),
        inArray(notificationDeliveries.status, ["failed", "not_configured"]),
        ne(bookings.status, "cancelled"),
      ),
    )
    .groupBy(notificationDeliveries.id, bookings.id, people.id, trips.id)
    .orderBy(desc(notificationDeliveries.attemptedAt));
}

/** The full attempt trail for one booking/purpose, oldest first. */
export async function listDeliveryAttempts(
  db: AppDb,
  shopId: string,
  bookingId: string,
  kind: Notification["kind"],
) {
  return db
    .select()
    .from(notificationDeliveryAttempts)
    .where(
      and(
        eq(notificationDeliveryAttempts.shopId, shopId),
        eq(notificationDeliveryAttempts.bookingId, bookingId),
        eq(notificationDeliveryAttempts.kind, kind),
      ),
    )
    .orderBy(asc(notificationDeliveryAttempts.attemptedAt));
}
