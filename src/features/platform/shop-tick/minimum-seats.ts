import type { AppDb } from "@/db/client";
import { recordNotificationDelivery, shopSenderFor } from "@/db/notifications";
import { refundBookingsForShopCancelledTrip, shopCancellationPaymentStory } from "@/db/refunds";
import { cancelDeparturesBelowMinimum, listMinimumNotMetRecipients } from "@/db/trips";
import { notify, publicAppUrl, recipientLocale } from "@/lib/notifications";
import { publicSchedulePath } from "@/lib/public-routes";

export type MinimumSeatsSweepSummary = {
  considered: number;
  cancelled: number;
  /** Departures past their moment that this pass left for the next: never silently capped. */
  deferred: number;
  notified: number;
  unreachable: number;
  refunded: number;
  /** Captured money this pass could not reverse: a staff queue, never silence. */
  refundsOwed: number;
};

/**
 * **Make the call on every departure that named a minimum head count** and has
 * reached the moment it said it would decide (ADR
 * 20260813-minimum-head-count-departures), then refund and tell its divers.
 *
 * Idempotent by construction. Cancelling is conditional on the departure still
 * being `scheduled`, and reinstating one clears its minimum
 * (`clearMinimumSeats`), so a trip a human has put back is never taken away
 * again by the next tick: the shop always gets the last word.
 */
export async function sweepMinimumSeats(db: AppDb, now: Date): Promise<MinimumSeatsSweepSummary> {
  const sweep = await cancelDeparturesBelowMinimum(db, { now });
  const origin = publicAppUrl();
  const summary: MinimumSeatsSweepSummary = {
    considered: sweep.considered,
    cancelled: sweep.cancelled.length,
    deferred: sweep.deferred,
    notified: 0,
    unreachable: 0,
    refunded: 0,
    refundsOwed: 0,
  };

  for (const departure of sweep.cancelled) {
    // The money half of the same promise. A diver who paid a full fare for a
    // departure a machine cancelled at 4 AM must not be holding a captured
    // charge when they read the mail, and the refund runs over every active
    // seat, not just the reachable ones, so a walk-in with no address gets
    // their money back too (ADR 20260813-shop-cancellation-refunds-itself).
    const refunds = await refundBookingsForShopCancelledTrip(db, {
      shopId: departure.shopId,
      tripId: departure.tripId,
    });
    for (const outcome of refunds.values()) {
      if (outcome.status === "refunded") summary.refunded += 1;
      else if (outcome.status !== "unpaid") summary.refundsOwed += 1;
    }
    const recipients = await listMinimumNotMetRecipients(db, departure.shopId, departure.tripId);
    // The shop's sender is the departure's, not the recipient's: read once,
    // and only when someone is actually emailed (performance audit 2026-11-11, item 11).
    let sender: ReturnType<typeof shopSenderFor> | undefined;
    for (const recipient of recipients) {
      // No email on file is not a failure to retry: it is a walk-in the shop
      // seated on a name alone, and the counter already knows. Recorded so a
      // shop can see who was *not* told, which is the whole reason this
      // channel is tracked per booking.
      if (!recipient.email || !origin) {
        await recordNotificationDelivery(db, {
          shopId: departure.shopId,
          bookingId: recipient.bookingId,
          kind: "trip_minimum_not_met",
          delivery: { status: "not_configured" },
        });
        summary.unreachable += 1;
        continue;
      }
      // `notify` directly: the shop tick runs sub-daily and must stay off the
      // durable retry queue (src/lib/cron-schedule.test.ts), so the shop's
      // Reply-To and postal line are resolved by hand here rather than by the
      // queue path that normally adds them.
      sender ??= shopSenderFor(db, departure.shopId);
      const delivery = await notify({
        kind: "trip_minimum_not_met",
        tripId: departure.tripId,
        bookingId: recipient.bookingId,
        shopId: departure.shopId,
        sender: await sender,
        to: recipient.email,
        locale: recipientLocale(recipient.personLocale, departure.shopDefaultLocale),
        diverName: recipient.fullName,
        shopName: departure.shopName,
        tripTitle: departure.title,
        startsAt: departure.startsAt,
        timezone: departure.shopTimezone,
        minimumBookings: departure.minimum,
        bookedCount: departure.booked,
        paymentStory: shopCancellationPaymentStory(
          refunds.get(recipient.bookingId) ?? { status: "unpaid" },
        ),
        scheduleUrl: new URL(publicSchedulePath(departure.shopSlug), `${origin}/`).toString(),
      });
      await recordNotificationDelivery(db, {
        shopId: departure.shopId,
        bookingId: recipient.bookingId,
        kind: "trip_minimum_not_met",
        delivery,
      });
      if (delivery.status === "sent") summary.notified += 1;
      else summary.unreachable += 1;
    }
  }
  return summary;
}
