import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { dueCheckoutRecovery, RECOVERY_DELAY_HOURS } from "@/lib/checkout-recovery";
import { nowDate } from "@/lib/clock";
import {
  type NotificationDelivery,
  type NotificationProvider,
  notificationProviderFromEnvironment,
  notify,
} from "@/lib/notifications";
import { type CheckoutProvider, checkoutProviderFromEnvironment } from "@/lib/payments/checkout";
import { refreshCheckoutFromStripe } from "./checkouts";
import type { AppDb } from "./client";
import { bookingCheckouts, shops, trips } from "./schema";

const HOUR_MS = 60 * 60 * 1000;

export type CheckoutRecoveryRunSummary = {
  /** Pending checkouts old enough to be worth reconciling with Stripe. */
  scanned: number;
  /** Recovery emails actually sent. */
  sent: number;
  /** Reconciled as no longer pending (paid or expired) — nothing to send. */
  resolved: number;
  /** Send attempted but failed or no provider configured. */
  failed: number;
};

export type SendDueCheckoutRecoveriesOptions = {
  /** Injectable clock; defaults to now. */
  now?: Date;
  emailProvider?: NotificationProvider;
  checkoutProvider?: CheckoutProvider;
};

/**
 * Send a recovery email for every checkout that's sat unpaid long enough to
 * be worth a nudge, across all shops. A stale local `pending` row is a lead,
 * not proof — a delayed webhook can leave an already-paid session looking
 * pending — so each candidate is reconciled against Stripe
 * (`refreshCheckoutFromStripe`) before anything is sent; only a checkout
 * still genuinely pending afterward gets the email. Idempotent: dedup lives
 * on `booking_checkouts.abandoned_recovery_sent_at`, set only after a
 * confirmed send, so a failed attempt (no provider configured, a transient
 * error) is retried on the next run rather than silently dropped
 * (docs ADR 20260726-abandoned-checkout-recovery).
 *
 * There is no timer in the app: a cron caller drives `now`, the same
 * mechanism the pre-trip reminder cadence uses
 * (docs ADR 20260721-scheduled-reminder-cadence).
 */
export async function sendDueCheckoutRecoveries(
  db: AppDb,
  options: SendDueCheckoutRecoveriesOptions = {},
): Promise<CheckoutRecoveryRunSummary> {
  const now = options.now ?? nowDate();
  const emailProvider = options.emailProvider ?? notificationProviderFromEnvironment();
  const checkoutProvider = options.checkoutProvider ?? checkoutProviderFromEnvironment();
  const staleBefore = new Date(now.getTime() - RECOVERY_DELAY_HOURS * HOUR_MS);

  // Coarse SQL filter (bounded, not a full-table scan) — the exact rule is
  // still `dueCheckoutRecovery`, applied per row below as the single source
  // of truth so the DB filter only needs to be a safe superset.
  const candidates = await db
    .select({ checkout: bookingCheckouts, trip: trips, shop: shops })
    .from(bookingCheckouts)
    .innerJoin(trips, eq(trips.id, bookingCheckouts.tripId))
    .innerJoin(shops, eq(shops.id, bookingCheckouts.shopId))
    .where(
      and(
        eq(bookingCheckouts.status, "pending"),
        isNull(bookingCheckouts.abandonedRecoverySentAt),
        lte(bookingCheckouts.createdAt, staleBefore),
        or(isNull(bookingCheckouts.expiresAt), gt(bookingCheckouts.expiresAt, now)),
      ),
    );

  const summary: CheckoutRecoveryRunSummary = {
    scanned: candidates.length,
    sent: 0,
    resolved: 0,
    failed: 0,
  };

  for (const { checkout, trip, shop } of candidates) {
    if (!dueCheckoutRecovery(checkout, now)) continue;

    // Ask Stripe directly — the return URL/local row alone never proves
    // abandonment, only Stripe's own state does (mirrors the confirmation
    // page's webhook-less fallback).
    const reconciled = await refreshCheckoutFromStripe(
      db,
      checkout.shopId,
      checkout.id,
      checkoutProvider,
    );
    if (reconciled?.status !== "pending" || !reconciled.checkoutUrl) {
      summary.resolved += 1;
      continue;
    }

    let delivery: NotificationDelivery;
    if (reconciled.customerEmail) {
      delivery = await notify(
        {
          kind: "checkout_recovery",
          checkoutId: reconciled.id,
          shopId: shop.id,
          to: reconciled.customerEmail,
          shopName: shop.name,
          tripTitle: trip.title,
          startsAt: trip.startsAt,
          endsAt: trip.endsAt,
          timezone: shop.timezone,
          checkoutUrl: reconciled.checkoutUrl,
        },
        emailProvider,
      );
    } else {
      delivery = { status: "not_configured" };
    }

    if (delivery.status === "sent") {
      await db
        .update(bookingCheckouts)
        .set({ abandonedRecoverySentAt: now })
        .where(eq(bookingCheckouts.id, reconciled.id));
      summary.sent += 1;
    } else {
      summary.failed += 1;
    }
  }

  return summary;
}
