import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { capturedPaymentStatuses } from "@/lib/payment-source";
import { isUuid } from "@/lib/uuid";
import { lockSeatsInOrder } from "./checkouts";
import type { AppDb } from "./client";
import { heldUnattributedRefund } from "./payment-operations";
import { setBookingPayment } from "./payments";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPayments,
  bookings,
  paymentOperationIntents,
  people,
  trips,
} from "./schema";
import { recordShopActivityWithin } from "./shop-activity";

/**
 * **A dashboard refund on a party checkout, waiting for staff to name the
 * seat** (issue #2293).
 *
 * A refund made in the Stripe dashboard names an amount, never a seat. On a
 * checkout that paid for one seat the webhook writes it onto that seat; on a
 * party's checkout it counts the money on the checkout and parks the rest here
 * (`parkStripeReversal`, `src/db/refunds.ts`), and no automatic refund of that
 * checkout's seats runs until it is matched (`checkoutHasUnreconciledReversal`).
 * Aaron, 2026-10-13: staff pick the seat from the Orders index; there is no
 * proportional split and no oldest-first rule.
 *
 * Each match takes what the chosen seat still holds, up to the amount left:
 * one refund that covered two seats is matched twice, and the row resolves
 * when nothing is left. Money never moves from here — Stripe already moved
 * it; this writes down whose it was.
 */

export type UnattributedRefundSeat = {
  bookingId: string;
  diverName: string;
  /** What this seat still holds from the checkout's payment. */
  heldCents: number;
};

export type UnattributedRefund = {
  intentId: string;
  checkoutId: string;
  /** Refunded in Stripe and carried by no seat yet. */
  amountCents: number;
  currency: string;
  /** The charge the refund came off — what a shop searches its dashboard for. */
  chargeId: string | null;
  refundedAt: Date;
  tripId: string;
  tripTitle: string | null;
  tripStartsAt: Date | null;
  /** The checkout's seats that still hold money from it: the choices. */
  seats: UnattributedRefundSeat[];
};

/** At most this many rows on the queue. */
const QUEUE_LIMIT = 50;

/** The queue, oldest first, for one shop. */
export async function listUnattributedRefunds(
  db: AppDb,
  shopId: string,
): Promise<UnattributedRefund[]> {
  if (!isUuid(shopId)) return [];
  const held = await db
    .select({
      intentId: paymentOperationIntents.id,
      checkoutId: bookingCheckouts.id,
      amountCents: paymentOperationIntents.amountCents,
      chargeId: paymentOperationIntents.stripeObjectId,
      refundedAt: paymentOperationIntents.startedAt,
      currency: bookingCheckouts.currency,
      sessionId: bookingCheckouts.stripeSessionId,
      tripId: bookingCheckouts.tripId,
      tripTitle: trips.title,
      tripStartsAt: trips.startsAt,
    })
    .from(paymentOperationIntents)
    .innerJoin(
      bookingCheckouts,
      and(
        eq(bookingCheckouts.id, paymentOperationIntents.checkoutId),
        eq(bookingCheckouts.shopId, paymentOperationIntents.shopId),
      ),
    )
    // diveday:allow-deleted-trips: money refunded on a deleted departure is
    // still somebody's; the row names the departure as it stood.
    .leftJoin(trips, and(eq(trips.id, bookingCheckouts.tripId), eq(trips.shopId, shopId)))
    .where(
      and(
        eq(paymentOperationIntents.shopId, shopId),
        eq(paymentOperationIntents.status, "started"),
        heldUnattributedRefund(),
        gt(paymentOperationIntents.amountCents, 0),
      ),
    )
    .orderBy(
      asc(paymentOperationIntents.startedAt),
      asc(trips.title),
      asc(paymentOperationIntents.amountCents),
      asc(paymentOperationIntents.id),
    )
    .limit(QUEUE_LIMIT);
  if (held.length === 0) return [];

  const checkoutIds = [...new Set(held.map((row) => row.checkoutId))];
  const seatRows = await db
    .select({
      checkoutId: bookingCheckoutBookings.checkoutId,
      bookingId: bookingCheckoutBookings.bookingId,
      diverName: people.fullName,
      heldCents: bookingPayments.amountCents,
      providerRef: bookingPayments.providerRef,
    })
    .from(bookingCheckoutBookings)
    .innerJoin(
      bookings,
      and(
        eq(bookings.id, bookingCheckoutBookings.bookingId),
        eq(bookings.shopId, bookingCheckoutBookings.shopId),
      ),
    )
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, bookings.shopId)))
    .innerJoin(
      bookingPayments,
      and(eq(bookingPayments.bookingId, bookings.id), eq(bookingPayments.shopId, bookings.shopId)),
    )
    .where(
      and(
        eq(bookingCheckoutBookings.shopId, shopId),
        inArray(bookingCheckoutBookings.checkoutId, checkoutIds),
        inArray(bookingPayments.status, [...capturedPaymentStatuses]),
        gt(bookingPayments.amountCents, 0),
      ),
    )
    .orderBy(asc(people.fullName), asc(bookings.id));

  return held.map((row) => ({
    intentId: row.intentId,
    checkoutId: row.checkoutId,
    amountCents: row.amountCents ?? 0,
    currency: row.currency,
    chargeId: row.chargeId,
    refundedAt: row.refundedAt,
    tripId: row.tripId,
    tripTitle: row.tripTitle,
    tripStartsAt: row.tripStartsAt,
    seats: seatRows
      .filter((seat) => seat.checkoutId === row.checkoutId && seat.providerRef === row.sessionId)
      .map((seat) => ({
        bookingId: seat.bookingId,
        diverName: seat.diverName,
        heldCents: seat.heldCents ?? 0,
      })),
  }));
}

/**
 * What matching a held refund to a seat did — a code, never a sentence.
 *
 * - `attributed` — the seat now carries its share; `remainingCents` is what
 *   is still waiting for another seat (zero when the row is done).
 * - `not_found` — no held refund by that id in this shop, or it is already
 *   fully matched: a second tap never refunds a seat twice.
 * - `not_on_checkout` — the seat was not paid through that refund's checkout.
 * - `nothing_held` — the seat holds no money from that checkout any more.
 */
export type AttributeUnattributedRefundOutcome =
  | { status: "attributed"; remainingCents: number }
  | { status: "not_found" | "not_on_checkout" | "nothing_held" };

/**
 * Write a held dashboard refund onto the seat a staffer picked.
 *
 * Under the seat's lock, then the held row's (the order every writer of a
 * checkout's seats takes, `lockSeatsInOrder`), so a double tap or two staffers
 * at once spend the amount once. The seat moves exactly as a one-seat
 * dashboard refund moves it (`stripe_dashboard_refund` on the payment trail).
 * The caller authorizes: owner or manager, behind the money step-up.
 */
export async function attributeUnattributedRefund(
  db: AppDb,
  input: { shopId: string; intentId: string; bookingId: string; actorPersonId: string },
): Promise<AttributeUnattributedRefundOutcome> {
  const { shopId, intentId, bookingId } = input;
  if (!isUuid(shopId) || !isUuid(intentId) || !isUuid(bookingId)) return { status: "not_found" };

  return db.transaction(async (tx): Promise<AttributeUnattributedRefundOutcome> => {
    const heldNow = and(
      eq(paymentOperationIntents.id, intentId),
      eq(paymentOperationIntents.shopId, shopId),
      eq(paymentOperationIntents.status, "started"),
      heldUnattributedRefund(),
      gt(paymentOperationIntents.amountCents, 0),
    );
    const [peek] = await tx
      .select({ checkoutId: paymentOperationIntents.checkoutId })
      .from(paymentOperationIntents)
      .where(heldNow)
      .limit(1);
    if (!peek?.checkoutId) return { status: "not_found" };

    const [checkout] = await tx
      .select()
      .from(bookingCheckouts)
      .where(and(eq(bookingCheckouts.id, peek.checkoutId), eq(bookingCheckouts.shopId, shopId)))
      .limit(1);
    if (!checkout) return { status: "not_found" };
    const [covered] = await tx
      .select({ bookingId: bookingCheckoutBookings.bookingId })
      .from(bookingCheckoutBookings)
      .where(
        and(
          eq(bookingCheckoutBookings.shopId, shopId),
          eq(bookingCheckoutBookings.checkoutId, checkout.id),
          eq(bookingCheckoutBookings.bookingId, bookingId),
        ),
      )
      .limit(1);
    if (!covered) return { status: "not_on_checkout" };

    // The seat, then the held row: re-read under both locks, because the
    // amount and the seat's balance are what this write is made of.
    await lockSeatsInOrder(tx, [bookingId]);
    const [intent] = await tx.select().from(paymentOperationIntents).where(heldNow).for("update");
    if (!intent || intent.amountCents === null || intent.checkoutId !== checkout.id) {
      return { status: "not_found" };
    }
    const [payment] = await tx
      .select()
      .from(bookingPayments)
      .where(
        and(
          eq(bookingPayments.shopId, shopId),
          eq(bookingPayments.bookingId, bookingId),
          eq(bookingPayments.providerRef, checkout.stripeSessionId),
          inArray(bookingPayments.status, [...capturedPaymentStatuses]),
        ),
      )
      .limit(1);
    const heldCents = payment?.amountCents ?? 0;
    if (!payment || heldCents <= 0) return { status: "nothing_held" };

    const taken = Math.min(heldCents, intent.amountCents);
    const kept = heldCents - taken;
    await setBookingPayment(tx, {
      shopId,
      bookingId,
      // The shape a one-seat dashboard refund writes: a partial leaves what the
      // shop still holds and stays `partly_refunded`.
      status: kept > 0 ? "partly_refunded" : "refunded",
      amountCents: kept > 0 ? kept : heldCents,
      currency: payment.currency,
      provider: "stripe",
      providerRef: checkout.stripeSessionId,
      operation: "stripe_dashboard_refund",
    });

    const remainingCents = intent.amountCents - taken;
    await tx
      .update(paymentOperationIntents)
      .set(
        remainingCents > 0
          ? { amountCents: remainingCents }
          : { amountCents: 0, status: "succeeded", resolvedAt: nowDate() },
      )
      .where(eq(paymentOperationIntents.id, intent.id));

    await recordShopActivityWithin(tx, {
      shopId,
      actorPersonId: input.actorPersonId,
      write: { code: "dashboard_refund_matched", bookingId },
    });
    return { status: "attributed", remainingCents };
  });
}
