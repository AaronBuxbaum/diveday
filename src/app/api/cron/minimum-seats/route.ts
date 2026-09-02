import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { recordNotificationDelivery, sendNotification } from "@/db/notifications";
import { refundBookingsForShopCancelledTrip, shopCancellationPaymentStory } from "@/db/refunds";
import { cancelDeparturesBelowMinimum, listMinimumNotMetRecipients } from "@/db/trips";
import { log } from "@/lib/log";
import { publicAppUrl } from "@/lib/notifications";
import { recipientLocale } from "@/lib/notifications/kinds";
import { flushLogs } from "@/lib/observability";
import { publicSchedulePath } from "@/lib/public-routes";

/**
 * A pass cancels at most `MINIMUM_SEATS_SWEEP_LIMIT` departures and emails
 * their divers. The mail is the slow half — one message per booking on each
 * cancelled trip — so this is sized like the reminder pass rather than the
 * series roll.
 */
export const maxDuration = 60;

/**
 * Its own Sentry monitor. A missed minimum-seats pass is a specific,
 * diver-visible failure: people who were promised an answer at a stated hour
 * do not get one, and by the time anybody notices they are at the dock. That
 * is a different incident from a missed reminder.
 */
const CRON_MONITOR_SLUG =
  process.env.SENTRY_MINIMUM_SEATS_CRON_MONITOR_SLUG || "diveday-minimum-seats-sweep";

/** Must stay in lockstep with the `crons` entry in vercel.json. */
const CRON_MONITOR_CONFIG = {
  schedule: { type: "crontab", value: "20 * * * *" },
  checkinMargin: 20,
  maxRuntime: 5,
  timezone: "Etc/UTC",
} as const;

/**
 * Make the call on every departure that named a minimum head count and has
 * reached the moment it said it would decide (ADR
 * 20260813-minimum-head-count-departures).
 *
 * **Hourly, not nightly.** The deadline is a promise printed on the booking
 * page — "we'll confirm by Thu 14 Aug, 7:30 AM" — and a nightly pass would
 * make that promise true to within about a day. An hourly one makes it true to
 * within an hour, which is the resolution a shop states its window in. The pass
 * is cheap: the query is an index scan over scheduled trips in a window, and on
 * the great majority of ticks it cancels nothing at all.
 *
 * Idempotent by construction. Cancelling is conditional on the departure still
 * being `scheduled`, and reinstating one clears its minimum
 * (`clearMinimumSeats`), so a trip a human has put back is never taken away
 * again by the next tick — the shop always gets the last word.
 *
 * Fails closed exactly like the other scheduled routes: `CRON_SECRET` must be
 * configured and presented as a bearer token, or the endpoint answers 503
 * (unconfigured) / 401 (wrong or missing token) and writes nothing.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse(null, { status: 401 });
  }

  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: CRON_MONITOR_SLUG, status: "in_progress" },
    CRON_MONITOR_CONFIG,
  );

  try {
    const db = await getDb();
    const sweep = await cancelDeparturesBelowMinimum(db);
    const origin = publicAppUrl();
    let notified = 0;
    let unreachable = 0;
    let refunded = 0;
    /** Captured money this pass could not reverse — a staff queue, never silence. */
    let refundsOwed = 0;

    for (const departure of sweep.cancelled) {
      // The money half of the same promise. A diver who paid a full fare for a
      // departure a machine cancelled at 4 AM must not be holding a captured
      // charge when they read the mail — and the refund runs over every active
      // seat, not just the reachable ones, so a walk-in with no address gets
      // their money back too (ADR 20260813-shop-cancellation-refunds-itself).
      const refunds = await refundBookingsForShopCancelledTrip(db, {
        shopId: departure.shopId,
        tripId: departure.tripId,
      });
      for (const outcome of refunds.values()) {
        if (outcome.status === "refunded") refunded += 1;
        else if (outcome.status !== "unpaid") refundsOwed += 1;
      }
      const recipients = await listMinimumNotMetRecipients(db, departure.shopId, departure.tripId);
      for (const recipient of recipients) {
        // No email on file is not a failure to retry — it is a walk-in the
        // shop seated on a name alone, and the counter already knows. Recorded
        // so a shop can see who was *not* told, which is the whole reason this
        // channel is tracked per booking.
        if (!recipient.email || !origin) {
          await recordNotificationDelivery(db, {
            shopId: departure.shopId,
            bookingId: recipient.bookingId,
            kind: "trip_minimum_not_met",
            delivery: { status: "not_configured" },
          });
          unreachable += 1;
          continue;
        }
        const delivery = await sendNotification(db, {
          kind: "trip_minimum_not_met",
          tripId: departure.tripId,
          bookingId: recipient.bookingId,
          shopId: departure.shopId,
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
        if (delivery.status === "sent") notified += 1;
        else unreachable += 1;
      }
    }

    log("cron_minimum_seats.sweep_complete", "info", {
      considered: sweep.considered,
      cancelled: sweep.cancelled.length,
      // Never silently capped, same rule as the series roll.
      deferred: sweep.deferred,
      notified,
      unreachable,
      refunded,
      refundsOwed,
    });

    Sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "ok" });
    return NextResponse.json({
      considered: sweep.considered,
      cancelled: sweep.cancelled.length,
      deferred: sweep.deferred,
      notified,
      unreachable,
      refunded,
      refundsOwed,
    });
  } catch (error) {
    Sentry.captureException(error, { tags: { cron_scan: "minimum_seats" } });
    log("cron_minimum_seats.sweep_failed", "error", { scan: "sweep" });
    Sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "error" });
    return NextResponse.json({ error: "sweep_unavailable" }, { status: 503 });
  } finally {
    await flushLogs();
  }
}
