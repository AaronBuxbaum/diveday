import { and, eq } from "drizzle-orm";
import { log } from "@/lib/log";
import {
  type PaymentSourceLookup,
  paymentSourceLookupFromEnvironment,
} from "@/lib/payments/payment-sources";
import { recordCheckoutPaymentIntent } from "./checkouts";
import type { AppDb } from "./client";
import { recordOrderPaymentIntent } from "./orders";
import type { BookingCheckout, Order } from "./schema";
import { bookingCheckouts, orders } from "./schema";

/**
 * What a Stripe charge DiveDay is told about was for: one of its own orders
 * (an invoice), one of its own booking checkouts, or nothing DiveDay raised.
 */
export type StripePaymentTarget =
  | { kind: "order"; order: Order }
  | { kind: "checkout"; checkout: BookingCheckout }
  | { kind: "none" };

/**
 * Stripe could not be asked which object a PaymentIntent paid for. Thrown, so
 * the webhook answers non-2xx and Stripe delivers the event again — a refund or
 * a dispute must not be dropped because the network was down for a second.
 */
export class PaymentSourceLookupFailed extends Error {
  constructor() {
    super("stripe_payment_source_lookup_failed");
    this.name = "PaymentSourceLookupFailed";
  }
}

/**
 * **Find the order or checkout a refund or dispute is about** (ADR
 * 20261009-stripe-reversals-reach-diveday).
 *
 * A `charge.refunded` or `charge.dispute.*` event names a PaymentIntent and the
 * connected account, nothing else of DiveDay's. The PaymentIntent is recorded on
 * the order (`invoice.paid`) and the checkout (`checkout.session.completed`) as
 * each settles, so this is ordinarily one indexed read. When neither carries it
 * — the event that settled it did not say — Stripe is asked once, and the
 * answer is written back so the next event is local again.
 *
 * **Scoped to the account the event came from.** A row belonging to another
 * connected account is never matched, whatever its PaymentIntent says: the
 * event's `account` is the only statement of whose money this is.
 */
export async function findStripePaymentTarget(
  db: AppDb,
  input: { stripeAccountId: string; paymentIntentId: string },
  lookup: PaymentSourceLookup = paymentSourceLookupFromEnvironment(),
): Promise<StripePaymentTarget> {
  const [order] = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.stripePaymentIntentId, input.paymentIntentId),
        eq(orders.stripeAccountId, input.stripeAccountId),
      ),
    )
    .limit(1);
  if (order) return { kind: "order", order };

  const [checkout] = await db
    .select()
    .from(bookingCheckouts)
    .where(
      and(
        eq(bookingCheckouts.stripePaymentIntentId, input.paymentIntentId),
        eq(bookingCheckouts.stripeAccountId, input.stripeAccountId),
      ),
    )
    .limit(1);
  if (checkout) return { kind: "checkout", checkout };

  const source = await lookup.findSource(input.stripeAccountId, input.paymentIntentId);
  if (source.status === "failed") throw new PaymentSourceLookupFailed();

  if (source.status === "invoice") {
    const [found] = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.stripeInvoiceId, source.stripeInvoiceId),
          eq(orders.stripeAccountId, input.stripeAccountId),
        ),
      )
      .limit(1);
    if (found) {
      await recordOrderPaymentIntent(db, {
        stripeInvoiceId: found.stripeInvoiceId,
        paymentIntentId: input.paymentIntentId,
        expectedAccountId: input.stripeAccountId,
      });
      return { kind: "order", order: found };
    }
  }

  if (source.status === "checkout_session") {
    const [found] = await db
      .select()
      .from(bookingCheckouts)
      .where(
        and(
          eq(bookingCheckouts.stripeSessionId, source.stripeSessionId),
          eq(bookingCheckouts.stripeAccountId, input.stripeAccountId),
        ),
      )
      .limit(1);
    if (found) {
      await recordCheckoutPaymentIntent(db, {
        stripeSessionId: found.stripeSessionId,
        paymentIntentId: input.paymentIntentId,
        expectedAccountId: input.stripeAccountId,
      });
      return { kind: "checkout", checkout: found };
    }
  }

  // The shop's own till on the same Stripe account, a tip, or an account the
  // lookup cannot reach without a key: nothing DiveDay should record.
  log("stripe_payment_target.not_found", "info", {
    account: input.stripeAccountId,
    lookup: source.status,
  });
  return { kind: "none" };
}
