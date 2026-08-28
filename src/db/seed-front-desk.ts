import { and, eq } from "drizzle-orm";
import { nowDate, nowMs } from "@/lib/clock";
import type { DbExecutor } from "./client";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  lastMinuteListEntries,
  notificationDeliveries,
  notificationDeliveryAttempts,
  paymentOperationIntents,
  people,
  personRoles,
  rollCallEvents,
  tripLastMinutePromos,
  tripWaitlistEntries,
} from "./schema";
import { at, dateAt, nextCreatedAt } from "./seed-clock";

/**
 * The paperwork side of a working week: divers waiting on a sold-out charter,
 * rental sizes already asked for on the boats that have not sailed yet, a
 * couple of invoices out, and the confirmation emails that went with them —
 * including one that bounced, because they do.
 *
 * Nothing here touches today's boat. Its roster, its readiness counts, and the
 * blocker copy on the departure board are asserted exactly, and they describe a
 * morning where the work has not been done yet — which is the point of showing
 * it.
 */
export async function seedFrontDesk(
  db: DbExecutor,
  shopId: string,
  customers: { id: string }[],
  tripRows: { id: string; title: string }[],
  bookingRows: { id: string; tripId: string; personId: string }[],
  includeHistoryData: boolean,
): Promise<void> {
  const tripByTitle = new Map(tripRows.map((trip) => [trip.title, trip.id]));
  const wreckId = tripByTitle.get("Wreck Trip — Spiegel Grove");

  // Keep the export useful on a fresh demo: these are the small operational
  // records that otherwise tend to remain empty because they are created by
  // later staff actions in a real shop.
  const listPeople = [9, 10, 11, 12, 43, 45, 47, 49, 51]
    .map((index) => customers[index])
    .filter((person) => person !== undefined);
  if (includeHistoryData && listPeople.length > 0) {
    await db
      .insert(lastMinuteListEntries)
      .values(
        listPeople.map((person, index) => ({
          shopId,
          personId: person.id,
          availableFrom: dateAt(index === 0 ? 0 : 2),
          availableUntil: dateAt(30),
          unsubscribedAt: index === listPeople.length - 1 ? nowDate() : null,
          createdAt: nextCreatedAt(),
        })),
      )
      .onConflictDoNothing();
  }

  // The sold-out charter is where a wait-list earns its keep.
  if (includeHistoryData && wreckId) {
    const waiting = [10, 11, 12].map((index) => customers[index]).filter((c) => c !== undefined);
    if (waiting.length > 0) {
      await db.insert(tripWaitlistEntries).values(
        waiting.map((person) => ({
          shopId,
          tripId: wreckId,
          personId: person.id,
          createdAt: nextCreatedAt(),
        })),
      );
    }

    await db
      .insert(tripLastMinutePromos)
      .values({
        shopId,
        tripId: wreckId,
        status: "sent",
        discountPercent: 25,
        code: "DEMO-REEF-25",
        stripeCouponId: "coupon_demo_reef",
        stripePromotionCodeId: "promo_demo_reef",
        expiresAt: at(2, 18),
        recipientCount: Math.max(1, listPeople.length - 1),
        createdByPersonId: null,
        createdAt: nextCreatedAt(),
      })
      .onConflictDoNothing();

    const booking = bookingRows.find((row) => row.tripId === wreckId);
    if (booking) {
      const [recorder] = await db
        .select({ id: people.id })
        .from(people)
        .innerJoin(personRoles, eq(personRoles.personId, people.id))
        .where(and(eq(people.shopId, shopId), eq(personRoles.role, "captain")))
        .limit(1);
      if (recorder) {
        await db.insert(rollCallEvents).values({
          shopId,
          tripId: wreckId,
          bookingId: booking.id,
          recordedByPersonId: recorder.id,
          status: "boarded",
          checkpoint: "departure",
          source: "live",
          occurredAt: nowDate(),
        });
      }
      const [checkout] = await db
        .insert(bookingCheckouts)
        .values({
          shopId,
          tripId: wreckId,
          status: "pending",
          currency: "usd",
          stripeAccountId: "acct_demo",
          stripeSessionId: "cs_demo_pending",
          checkoutUrl: "https://checkout.stripe.com/c/pay/demo-pending",
          customerEmail: "priya.sharma@example.com",
          amountPerDiverCents: 18_000,
          totalCents: 18_000,
          expiresAt: at(1, 12),
          createdAt: nextCreatedAt(),
        })
        .onConflictDoNothing({ target: bookingCheckouts.stripeSessionId })
        .returning();
      if (checkout) {
        await db.insert(bookingCheckoutBookings).values({
          shopId,
          checkoutId: checkout.id,
          bookingId: booking.id,
        });
      }
      await db
        .insert(paymentOperationIntents)
        .values({
          shopId,
          kind: "checkout_session",
          status: "succeeded",
          tripId: wreckId,
          bookingId: booking.id,
          stripeObjectId: "cs_demo_pending",
          startedAt: nextCreatedAt(),
          resolvedAt: nowDate(),
        })
        .onConflictDoNothing();
    }
  }

  // Orders are deliberately absent. An order belongs to a Stripe account the
  // shop connected itself, and fabricating one here would show the settings
  // page a connected integration whose "Refresh status" button then calls the
  // real Stripe API and fails. The payment states that gate boarding are
  // seeded on the wreck charter instead, where they are real.

  // The confirmations that went out. Only successes: a seeded bounce would put
  // a permanent red row on the dashboard that no amount of retrying clears,
  // since there is no provider behind it to succeed on the second attempt.
  const notified = bookingRows.filter((booking) => booking.tripId === wreckId).slice(0, 4);
  const deliveries = notified.map((booking, index) => ({
    shopId,
    bookingId: booking.id,
    kind: "booking_confirmation" as const,
    status: "sent" as const,
    providerMessageId: `demo-msg-${index}`,
    attemptedAt: new Date(nowMs() - (index + 1) * 60 * 60 * 1000),
  }));
  if (deliveries.length > 0) {
    await db.insert(notificationDeliveries).values(deliveries);
    await db
      .insert(notificationDeliveryAttempts)
      .values(deliveries.map((delivery) => ({ ...delivery, isRetry: false })));
  }
}
