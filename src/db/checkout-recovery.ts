import { and, asc, eq, gt, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { dueCheckoutRecovery, RECOVERY_DELAY_HOURS } from "@/lib/checkout-recovery";
import { nowDate } from "@/lib/clock";
import type { NotificationDelivery, NotificationProvider } from "@/lib/notifications";
import { type CheckoutProvider, checkoutProviderFromEnvironment } from "@/lib/payments/checkout";
import { markCheckoutExpiredBySessionId, markCheckoutPaidBySessionId } from "./checkouts";
import type { AppDb } from "./client";
import { notificationProviderForDb, sendNotification } from "./notifications";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPayments,
  bookings,
  shops,
  trips,
} from "./schema";

const HOUR_MS = 60 * 60 * 1000;
/** One cron tick's worth of work — keeps a growing backlog from starving the other jobs on the same daily run. */
const BATCH_LIMIT = 200;

export type CheckoutRecoveryRunSummary = {
  /** Pending checkouts old enough to be worth reconciling with Stripe. */
  scanned: number;
  /** Recovery emails actually sent. */
  sent: number;
  /** Reconciled as no longer pending (paid or expired) — nothing to send. */
  resolved: number;
  /** The trip or a linked booking was cancelled since checkout started — never send. */
  cancelled: number;
  /** The trip already departed — a "your spot is held" nudge would be meaningless. */
  departed: number;
  /** A linked booking was already paid, deposited, waived, or refunded through
   * another channel (counter cash, a staff-created order, a manual waiver) —
   * this Stripe session is stale, not evidence the diver still owes anything. */
  settled: number;
  /** Stripe couldn't be reached to reconcile this run; retried next run. */
  unreconciled: number;
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
 * pending — so each candidate is reconciled directly against Stripe before
 * anything is sent, and only a session Stripe itself confirms is still open
 * and unpaid gets the email. A Stripe lookup that fails or isn't configured
 * is left alone entirely (not resolved, not sent) rather than treated as
 * "still pending" — the ambiguous case must never read as confirmation.
 * Also refuses to send once the trip or any diver in the party has been
 * cancelled since the checkout started (the seat this would tell someone is
 * "still held" may no longer exist), once the trip has already departed (a
 * trip never leaves `scheduled` status on its own, so departure needs its
 * own check), or once any linked booking has settled through a channel this
 * checkout row never hears about — counter cash, a staff-created order, a
 * manual waiver — all of which write `booking_payments`, not
 * `booking_checkouts`, and none of which Stripe's own session state reflects
 * either. All three of those disqualifications are permanent, so each is
 * written back as `expired` the moment it's found — otherwise the disqualified
 * rows would never leave the `pending` pool and could eventually fill every
 * future run's `BATCH_LIMIT`, starving genuinely due checkouts. Idempotent: dedup lives on
 * `booking_checkouts.abandoned_recovery_sent_at`, set only after a confirmed
 * send, so a failed attempt (no provider configured, a transient error) is
 * retried on the next run rather than silently dropped
 * (docs ADR 20260726-abandoned-checkout-recovery).
 *
 * There is no timer in the app: a cron caller drives `now`, the same
 * mechanism the pre-trip reminder cadence uses
 * (docs ADR 20260721-scheduled-reminder-cadence). Known gap on that daily
 * cadence: a checkout created inside the last `RECOVERY_DELAY_HOURS` before a
 * tick can age past a short Stripe session expiry before the *next* tick ever
 * sees it as due, missing recovery entirely rather than merely running late
 * — accepted for now (same cron-granularity trade the reminder cadence
 * already makes), revisit if a shop's default session expiry turns out to be
 * this tight in practice.
 *
 * Known gap (Codex finding, accepted for now): candidates are scanned
 * oldest-due-first specifically so a persistently-retryable row (Stripe
 * unreachable, no email provider configured) doesn't jump the queue ahead of
 * genuinely new candidates — but a row that fails on *every* run still never
 * ages out on its own, so it keeps one `BATCH_LIMIT` slot occupied
 * indefinitely rather than the batch draining it after some number of
 * attempts. Bounded impact (one slot of 200 per shop-wide daily run) unless
 * many candidates are simultaneously poisoned, which reflects a real
 * standing problem (e.g. a shop with no email provider configured at all)
 * that's more useful to surface and fix at the source than to paper over
 * with a retry cap here.
 */
export async function sendDueCheckoutRecoveries(
  db: AppDb,
  options: SendDueCheckoutRecoveriesOptions = {},
): Promise<CheckoutRecoveryRunSummary> {
  const now = options.now ?? nowDate();
  const emailProvider = notificationProviderForDb(db, options.emailProvider);
  const checkoutProvider = options.checkoutProvider ?? checkoutProviderFromEnvironment();
  const staleBefore = new Date(now.getTime() - RECOVERY_DELAY_HOURS * HOUR_MS);

  // Coarse SQL filter, index-backed (booking_checkouts_recovery_scan_idx) and
  // batch-limited — the exact rule is still `dueCheckoutRecovery`, applied
  // per row below as the single source of truth so this filter only needs to
  // be a safe superset. Ordered oldest-due-first (Codex finding) so that a
  // backlog beyond BATCH_LIMIT always drains from the front: every terminal
  // disqualification below (departed/cancelled/settled) marks its row
  // `expired` immediately, so the only rows that can keep re-appearing here
  // run-over-run are ones still genuinely retryable (`unreconciled`,
  // `failed`) — this ordering makes sure those get first shot at each new
  // batch rather than an arbitrary scan order silently starving them behind
  // fresher candidates.
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
    )
    .orderBy(asc(bookingCheckouts.createdAt))
    .limit(BATCH_LIMIT);

  const summary: CheckoutRecoveryRunSummary = {
    scanned: candidates.length,
    sent: 0,
    resolved: 0,
    cancelled: 0,
    departed: 0,
    settled: 0,
    unreconciled: 0,
    failed: 0,
  };
  if (candidates.length === 0) return summary;

  // A trip already cancelled disqualifies every checkout on it in one pass;
  // a cancelled *booking* is per-party, so it needs its own lookup — a party
  // checkout with even one cancelled diver is stale (its quantity/total no
  // longer matches who's actually still booked).
  const candidateIds = candidates.map((c) => c.checkout.id);
  const cancelledBookingLinks = await db
    .select({ checkoutId: bookingCheckoutBookings.checkoutId })
    .from(bookingCheckoutBookings)
    .innerJoin(bookings, eq(bookings.id, bookingCheckoutBookings.bookingId))
    .where(
      and(
        inArray(bookingCheckoutBookings.checkoutId, candidateIds),
        eq(bookings.status, "cancelled"),
      ),
    );
  const checkoutIdsWithACancelledBooking = new Set(cancelledBookingLinks.map((l) => l.checkoutId));

  // A booking can settle through a channel this checkout row never hears
  // about — counter cash, a staff-created order, a manual waiver — all of
  // which write `booking_payments`, not `booking_checkouts`. Stripe still
  // reports the old session open (nobody ever completed *it*), so the
  // Stripe-reconciliation step below can't catch this on its own; the local
  // ledger is the only place that knows. One settled diver in a party makes
  // the whole checkout's held-total stale, same as one cancelled diver does.
  const settledBookingLinks = await db
    .select({ checkoutId: bookingCheckoutBookings.checkoutId })
    .from(bookingCheckoutBookings)
    .innerJoin(bookingPayments, eq(bookingPayments.bookingId, bookingCheckoutBookings.bookingId))
    .where(
      and(
        inArray(bookingCheckoutBookings.checkoutId, candidateIds),
        ne(bookingPayments.status, "unpaid"),
      ),
    );
  const checkoutIdsWithASettledBooking = new Set(settledBookingLinks.map((l) => l.checkoutId));

  for (const { checkout, trip, shop } of candidates) {
    if (!dueCheckoutRecovery(checkout, now)) continue;

    // A trip stays "scheduled" for its whole life — that status never flips
    // on departure — so a still-open Stripe session for a trip that already
    // sailed needs its own check; "your spot is still held" is meaningless
    // once boarding has closed.
    if (trip.startsAt <= now) {
      // Terminal and permanent — a departed trip never un-departs. Marked
      // `expired` (not left `pending`) so this row drops out of every future
      // batch's SQL filter; otherwise a growing pile of departed-trip
      // checkouts would keep re-filling BATCH_LIMIT forever, crowding out
      // genuinely due new candidates.
      await markCheckoutExpiredBySessionId(db, checkout.stripeSessionId);
      summary.departed += 1;
      continue;
    }

    if (trip.status !== "scheduled" || checkoutIdsWithACancelledBooking.has(checkout.id)) {
      // Same terminal-and-permanent reasoning as the departed case above.
      await markCheckoutExpiredBySessionId(db, checkout.stripeSessionId);
      summary.cancelled += 1;
      continue;
    }

    if (checkoutIdsWithASettledBooking.has(checkout.id)) {
      // Same terminal-and-permanent reasoning as the departed case above.
      await markCheckoutExpiredBySessionId(db, checkout.stripeSessionId);
      summary.settled += 1;
      continue;
    }

    // Ask Stripe directly — the return URL/local row alone never proves
    // abandonment, only Stripe's own state does. Handled explicitly rather
    // than through the confirmation page's `refreshCheckoutFromStripe`
    // fallback: that helper returns the *unchanged* local row when the
    // Stripe call itself fails, which reads identically to "Stripe confirmed
    // still pending" — exactly the ambiguity that must never be treated as
    // license to send.
    const lookup = await checkoutProvider.retrieveCheckoutSession(
      checkout.stripeAccountId,
      checkout.stripeSessionId,
    );
    if (lookup.status !== "ok") {
      summary.unreconciled += 1;
      continue;
    }
    if (lookup.session.paymentStatus === "paid") {
      await markCheckoutPaidBySessionId(db, checkout.stripeSessionId);
      summary.resolved += 1;
      continue;
    }
    if (lookup.session.stripeStatus === "expired") {
      await markCheckoutExpiredBySessionId(db, checkout.stripeSessionId);
      summary.resolved += 1;
      continue;
    }
    // Stripe itself confirms this session is still open and unpaid — safe to nudge.
    if (!checkout.checkoutUrl) {
      summary.unreconciled += 1;
      continue;
    }

    // Re-checked immediately before sending, not just against the
    // batch-start snapshots above (Codex finding): each candidate's Stripe
    // lookup takes real wall-clock time, so staff cancelling the trip or a
    // linked booking, or a diver settling one at the counter, mid-batch —
    // after this checkout's snapshot was taken but before its own turn in
    // this loop — would otherwise still get a "your spot is held"/"finish
    // paying" link for a party that's already cancelled or settled. Trip
    // status specifically (not `startsAt`, which is immutable) needs its own
    // fresh read: the batch-start `trip` here is the same stale snapshot the
    // settlement check below no longer relies on.
    const [freshTrip] = await db
      .select({ status: trips.status })
      .from(trips)
      .where(eq(trips.id, trip.id))
      .limit(1);
    if (freshTrip?.status !== "scheduled") {
      await markCheckoutExpiredBySessionId(db, checkout.stripeSessionId);
      summary.cancelled += 1;
      continue;
    }
    const [freshlyCancelled] = await db
      .select({ checkoutId: bookingCheckoutBookings.checkoutId })
      .from(bookingCheckoutBookings)
      .innerJoin(bookings, eq(bookings.id, bookingCheckoutBookings.bookingId))
      .where(
        and(eq(bookingCheckoutBookings.checkoutId, checkout.id), eq(bookings.status, "cancelled")),
      )
      .limit(1);
    if (freshlyCancelled) {
      await markCheckoutExpiredBySessionId(db, checkout.stripeSessionId);
      summary.cancelled += 1;
      continue;
    }
    const [freshlySettled] = await db
      .select({ checkoutId: bookingCheckoutBookings.checkoutId })
      .from(bookingCheckoutBookings)
      .innerJoin(bookingPayments, eq(bookingPayments.bookingId, bookingCheckoutBookings.bookingId))
      .where(
        and(
          eq(bookingCheckoutBookings.checkoutId, checkout.id),
          ne(bookingPayments.status, "unpaid"),
        ),
      )
      .limit(1);
    if (freshlySettled) {
      await markCheckoutExpiredBySessionId(db, checkout.stripeSessionId);
      summary.settled += 1;
      continue;
    }

    let delivery: NotificationDelivery;
    if (checkout.customerEmail) {
      delivery = await sendNotification(
        db,
        {
          kind: "checkout_recovery",
          checkoutId: checkout.id,
          shopId: shop.id,
          to: checkout.customerEmail,
          shopName: shop.name,
          tripTitle: trip.title,
          startsAt: trip.startsAt,
          endsAt: trip.endsAt,
          timezone: shop.timezone,
          checkoutUrl: checkout.checkoutUrl,
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
        .where(eq(bookingCheckouts.id, checkout.id));
      summary.sent += 1;
    } else {
      summary.failed += 1;
    }
  }

  return summary;
}
