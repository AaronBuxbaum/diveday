import { z } from "zod";
import { markCheckoutExpiredBySessionId, markCheckoutPaidBySessionId } from "@/db/checkouts";
import { getDb } from "@/db/client";
import { markOrderPaidByInvoiceId, markOrderVoidedByInvoiceId } from "@/db/orders";
import { disconnectShopStripeAccount, setShopStripeAccountStatus } from "@/db/stripe-accounts";
import { markTipExpiredBySessionId, markTipPaidBySessionId } from "@/db/tips";
import { claimStripeWebhookEvent, hasNewerAccountUpdate } from "@/db/webhook-events";
import { nowDate } from "@/lib/clock";
import { verifyStripeWebhook } from "@/lib/payments/webhook";

export const runtime = "nodejs";

const invoiceObjectSchema = z.object({
  id: z.string().min(1),
  amount_paid: z.number().int().optional(),
});

const checkoutSessionObjectSchema = z.object({
  id: z.string().min(1),
  payment_status: z.string().optional(),
});

const accountObjectSchema = z.object({
  id: z.string().min(1),
  charges_enabled: z.boolean(),
  payouts_enabled: z.boolean(),
  details_submitted: z.boolean(),
  // Optional: a fixture or an unusual event payload missing it still
  // parses — `setShopStripeAccountStatus` leaves the stored currency
  // untouched rather than resetting it to "usd" (task 60).
  default_currency: z.string().optional(),
});

/**
 * A single Connect webhook endpoint for every shop's connected account
 * (Stripe includes the connected account id as the event's top-level
 * `account` field). Fails closed on a bad/stale/missing signature before any
 * event is handled (docs ADR 20260719-stripe-connect-orders).
 */
export async function POST(request: Request) {
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");
  let verification = verifyStripeWebhook(payload, signature, process.env.STRIPE_WEBHOOK_SECRET);

  if (
    (verification.status === "not_configured" || verification.status === "invalid_signature") &&
    process.env.STRIPE_TEST_WEBHOOK_SECRET
  ) {
    const testVerification = verifyStripeWebhook(
      payload,
      signature,
      process.env.STRIPE_TEST_WEBHOOK_SECRET,
    );
    if (testVerification.status === "verified" || verification.status === "not_configured") {
      verification = testVerification;
    }
  }

  if (verification.status === "not_configured") return new Response(null, { status: 503 });
  if (verification.status !== "verified") return new Response(null, { status: 400 });

  const { event } = verification;
  const db = await getDb();

  // Stripe's own event-creation time when present (real events always send
  // one); our own clock for a hand-built fixture that omits it. Recorded on
  // the ledger row and used to order same-account `account.updated` events —
  // see `hasNewerAccountUpdate`.
  const occurredAt = event.created !== undefined ? new Date(event.created * 1000) : nowDate();
  const accountId = event.account ?? null;

  // Claim this event id before doing anything else: a redelivered event
  // (Stripe's webhooks are at-least-once) is a no-op past this point,
  // independent of whichever handler's own state machine it would have hit
  // (docs ADR 20260719-stripe-connect-orders; security review finding).
  // Belt-and-suspenders — every handler below keeps its own idempotent
  // guards too.
  const claimed = await claimStripeWebhookEvent(db, {
    id: event.id,
    type: event.type,
    account: accountId,
    occurredAt,
  });
  if (!claimed) return new Response(null, { status: 200 });

  switch (event.type) {
    case "invoice.paid": {
      const invoice = invoiceObjectSchema.safeParse(event.data.object);
      if (invoice.success) {
        await markOrderPaidByInvoiceId(
          db,
          invoice.data.id,
          invoice.data.amount_paid ?? 0,
          event.account,
        );
      }
      break;
    }
    case "invoice.voided": {
      const invoice = invoiceObjectSchema.safeParse(event.data.object);
      if (invoice.success) await markOrderVoidedByInvoiceId(db, invoice.data.id, event.account);
      break;
    }
    case "checkout.session.completed": {
      const session = checkoutSessionObjectSchema.safeParse(event.data.object);
      // "completed" alone is not "paid": async payment methods complete the
      // session before the money settles. Only Stripe saying paid clears the
      // booking payment gate (docs ADR 20260721-checkout-at-booking).
      if (session.success && session.data.payment_status === "paid") {
        // A tip and a booking checkout share the Stripe session id space but
        // live in separate tables (docs ADR 20260726-post-trip-tipping); a
        // session id belongs to at most one, so try the booking-payment path
        // first and only fall back to tips when it finds nothing to mark.
        const checkout = await markCheckoutPaidBySessionId(db, session.data.id, event.account);
        if (!checkout) await markTipPaidBySessionId(db, session.data.id, event.account);
      }
      break;
    }
    case "checkout.session.async_payment_succeeded": {
      const session = checkoutSessionObjectSchema.safeParse(event.data.object);
      if (session.success) {
        const checkout = await markCheckoutPaidBySessionId(db, session.data.id, event.account);
        if (!checkout) await markTipPaidBySessionId(db, session.data.id, event.account);
      }
      break;
    }
    case "checkout.session.expired": {
      const session = checkoutSessionObjectSchema.safeParse(event.data.object);
      if (session.success) {
        const checkout = await markCheckoutExpiredBySessionId(db, session.data.id, event.account);
        if (!checkout) await markTipExpiredBySessionId(db, session.data.id, event.account);
      }
      break;
    }
    case "account.updated": {
      const account = accountObjectSchema.safeParse(event.data.object);
      if (account.success) {
        // Refuse a chronologically stale delivery rather than last-write-wins
        // regressing charges_enabled (and the other flags) back to an older
        // value — the flag that gates order creation (security review
        // finding).
        const stale = await hasNewerAccountUpdate(db, account.data.id, event.id, occurredAt);
        if (stale) {
          console.error("stripe webhook: refused a stale account.updated event", {
            accountId: account.data.id,
            eventId: event.id,
          });
          break;
        }
        await setShopStripeAccountStatus(db, account.data.id, {
          chargesEnabled: account.data.charges_enabled,
          payoutsEnabled: account.data.payouts_enabled,
          detailsSubmitted: account.data.details_submitted,
          defaultCurrency: account.data.default_currency,
        });
      }
      break;
    }
    case "account.application.deauthorized": {
      if (event.account) await disconnectShopStripeAccount(db, event.account);
      break;
    }
    default:
      // invoice.payment_failed and anything else: no local state change today.
      break;
  }

  return new Response(null, { status: 200 });
}
