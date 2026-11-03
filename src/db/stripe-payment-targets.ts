import { and, eq } from "drizzle-orm";
import { log } from "@/lib/log";
import type { PaymentSourceLookup } from "@/lib/payments/payment-sources";
import { recordCheckoutPaymentIntent } from "./checkouts";
import type { AppDb, DbExecutor } from "./client";
import { recordOrderPaymentIntent, stripeInvoiceOf } from "./orders";
import type { BookingCheckout, Order } from "./schema";
import { bookingCheckouts, orders } from "./schema";
import { paymentSourceLookupFromEnvironment } from "./stripe-providers";

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
    // diveday:any-checkout-purpose: a tip's charge is found here too, and answered below.
    .from(bookingCheckouts)
    .where(
      and(
        eq(bookingCheckouts.stripePaymentIntentId, input.paymentIntentId),
        eq(bookingCheckouts.stripeAccountId, input.stripeAccountId),
      ),
    )
    .limit(1);
  if (checkout) return checkoutTarget(checkout);

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
    // Matched by its invoice id, so never an order paid at the counter; the
    // narrowing is stated rather than asserted (ADR 20261009-counter-payments).
    const invoice = found ? stripeInvoiceOf(found) : null;
    if (found && invoice) {
      await recordOrderPaymentIntent(db, {
        stripeInvoiceId: invoice.stripeInvoiceId,
        paymentIntentId: input.paymentIntentId,
        expectedAccountId: input.stripeAccountId,
      });
      return { kind: "order", order: found };
    }
  }

  if (source.status === "checkout_session") {
    const [found] = await db
      .select()
      // diveday:any-checkout-purpose: a tip's session is found here too, and answered by checkoutTarget.
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
      return checkoutTarget(found);
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

/**
 * A fare's charge is the checkout's to reverse. A tip's is DiveDay's too, but
 * nothing records a tip's reversal yet, so it is answered as nothing to record:
 * a tip refund must never reach the fare's refund path and unpay a seat
 * (ADR 20260726-post-trip-tipping, issue #2718).
 */
function checkoutTarget(checkout: BookingCheckout): StripePaymentTarget {
  if (checkout.purpose === "fare") return { kind: "checkout", checkout };
  log("stripe_payment_target.tip", "info", { account: checkout.stripeAccountId });
  return { kind: "none" };
}
