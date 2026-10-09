import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import {
  markCheckoutExpiredBySessionId,
  markCheckoutPaidBySessionId,
  markCheckoutPaymentFailedBySessionId,
  recordCheckoutPaymentIntent,
  recordCheckoutStripeCustomer,
} from "@/db/checkouts";
import type { AppDb } from "@/db/client";
import { getDb } from "@/db/client";
import {
  markOrderPaidByInvoiceId,
  markOrderVoidedByInvoiceId,
  recordOrderPaymentIntent,
} from "@/db/orders";
import { recordStripeDispute } from "@/db/payment-disputes";
import { recordStripeChargeRefund } from "@/db/refunds";
import {
  disconnectShopStripeAccount,
  setShopStripeAccountStatus,
  stripeAccountHolder,
} from "@/db/stripe-accounts";
import { recordTipPaymentIntent } from "@/db/stripe-payment-targets";
import {
  markTipExpiredBySessionId,
  markTipPaidBySessionId,
  recordTipStripeCustomer,
} from "@/db/tips";
import {
  claimStripeWebhookEvent,
  hasNewerAccountUpdate,
  releaseStripeWebhookEventClaim,
} from "@/db/webhook-events";
import { dispatchIntegrationsAfterResponse } from "@/features/integrations";
import { nowDate } from "@/lib/clock";
import { type LogContext, log } from "@/lib/log";
import { invoicePaymentIntentId } from "@/lib/payments/invoicing";
import { paymentSourceLookupFromEnvironment } from "@/lib/payments/payment-sources";
import { demoStripeAccount, platformKeyIsLive } from "@/lib/payments/stripe-keys";
import { verifyStripeWebhook } from "@/lib/payments/webhook";

const invoiceObjectSchema = z.object({
  id: z.string().min(1),
  amount_paid: z.number().int().optional(),
  total_tax_amounts: z
    .array(z.object({ amount: z.number().int().nonnegative() }))
    .nullable()
    .optional(),
  total_taxes: z
    .array(z.object({ amount: z.number().int().nonnegative() }))
    .nullable()
    .optional(),
});

const checkoutSessionObjectSchema = z.object({
  id: z.string().min(1),
  payment_status: z.string().optional(),
  // What the session actually settled for, after any discount Stripe applied.
  // Optional/nullable so a fixture or an unusual payload without it still
  // parses — the completion then falls back to the amounts DiveDay asked for
  // rather than recording nothing collected.
  amount_total: z.number().int().nullable().optional(),
  total_details: z
    .object({ amount_tax: z.number().int().nonnegative().nullable().optional() })
    .nullable()
    .optional(),
  // The `cus_…` Stripe created for this session, string or expanded object.
  // Null on a session Stripe never minted a Customer for (`customer_creation:
  // "if_required"`), which is every abandoned one.
  customer: z
    .union([z.string().min(1), z.object({ id: z.string().min(1) })])
    .nullable()
    .optional(),
  // The PaymentIntent the session settled through — string or expanded. A
  // later refund or dispute names only this (ADR
  // 20261009-stripe-reversals-reach-diveday).
  payment_intent: z
    .union([z.string().min(1), z.object({ id: z.string().min(1) })])
    .nullable()
    .optional(),
});

/** A string-or-expanded Stripe reference, as its id. */
function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

/**
 * The Charge a `charge.refunded` event carries. Only the cumulative
 * `amount_refunded` and the PaymentIntent are read: the event's own refund is
 * not in the body (Stripe stopped embedding `refunds` on a Charge), and the
 * cumulative figure is the one that makes every delivery order converge
 * (`recordStripeChargeRefund`).
 */
const chargeObjectSchema = z.object({
  id: z.string().min(1),
  amount_refunded: z.number().int().nonnegative(),
  payment_intent: z
    .union([z.string().min(1), z.object({ id: z.string().min(1) })])
    .nullable()
    .optional(),
});

/** The Dispute every `charge.dispute.*` event carries. */
const disputeObjectSchema = z.object({
  id: z.string().min(1),
  amount: z.number().int().nonnegative(),
  currency: z.string().min(1),
  created: z.number().int(),
  status: z.string().min(1),
  reason: z.string().nullable().optional(),
  payment_intent: z
    .union([z.string().min(1), z.object({ id: z.string().min(1) })])
    .nullable()
    .optional(),
  evidence_details: z
    .object({ due_by: z.number().int().nullable().optional() })
    .nullable()
    .optional(),
});

/**
 * Record the PaymentIntent a session settled through, on whichever checkout
 * owns the session. Best-effort for the same reason the Customer write above
 * is: it must never swallow a settlement, and a refund that later finds no
 * recorded intent asks Stripe instead.
 */
async function recordSessionPaymentIntent(
  db: AppDb,
  session: z.infer<typeof checkoutSessionObjectSchema>,
  expectedAccountId: string | undefined,
  logOutcome: (outcome: string, extra?: LogContext) => void,
): Promise<void> {
  const paymentIntentId = idOf(session.payment_intent);
  if (!paymentIntentId) return;
  try {
    const onCheckout = await recordCheckoutPaymentIntent(db, {
      stripeSessionId: session.id,
      paymentIntentId,
      expectedAccountId,
    });
    // A tip shares the session id space (ADR 20260726-post-trip-tipping).
    if (!onCheckout && expectedAccountId) {
      await recordTipPaymentIntent(db, {
        stripeSessionId: session.id,
        paymentIntentId,
        expectedAccountId,
      });
    }
  } catch (error) {
    logOutcome("payment_intent_record_failed", { error: String(error) });
  }
}

/**
 * Record the Customer object this event says Stripe holds, on whichever of the
 * two session-shaped tables owns the id.
 *
 * Run on **every** `checkout.session.*` branch rather than only the paid one:
 * an `async_payment_failed` session still leaves a Customer behind at Stripe,
 * and that is exactly the object diver erasure has to be able to name
 * (issue #1621). A write-once no-op when the id is already recorded.
 *
 * Best-effort: this runs before the status dispatch, and a failure here must
 * never swallow a settlement.
 */
async function recordSessionCustomer(
  db: AppDb,
  session: z.infer<typeof checkoutSessionObjectSchema>,
  expectedAccountId: string | undefined,
  logOutcome: (outcome: string, extra?: LogContext) => void,
): Promise<void> {
  const customer = session.customer;
  if (!customer) return;
  const stripeCustomerId = typeof customer === "string" ? customer : customer.id;
  try {
    const recorded = await recordCheckoutStripeCustomer(db, {
      stripeSessionId: session.id,
      stripeCustomerId,
      expectedAccountId,
    });
    if (!recorded) {
      // The same try-checkout-then-tip fallback the settlement paths use: one
      // session id belongs to at most one of the two tables.
      await recordTipStripeCustomer(db, {
        stripeSessionId: session.id,
        stripeCustomerId,
        expectedAccountId,
      });
    }
  } catch (error) {
    logOutcome("customer_record_failed", { error: String(error) });
  }
}

function invoiceTaxCents(invoice: z.infer<typeof invoiceObjectSchema>): number | null {
  const amounts = invoice.total_tax_amounts ?? invoice.total_taxes;
  return amounts ? amounts.reduce((total, entry) => total + entry.amount, 0) : null;
}

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
  // Which secret actually verified the signature — used below to refuse a
  // livemode mismatch (security review finding, specialist-optimization-audit
  // §5): a correctly-signed *test-mode* event must never reach the handlers
  // that flip live orders/checkouts/tips to paid.
  let verifiedWith: "live" | "test" = "live";

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
      verifiedWith = "test";
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

  /**
   * What goes in the ledger row's `account` column.
   *
   * For an ordinary Connect delivery this is just `event.account`. The
   * exception is `account.updated`, whose ordering defense reads that column
   * back keyed on the connected account id **taken from the event body**
   * (`hasNewerAccountUpdate(db, account.data.id, …)`). If Stripe ever delivers
   * one without a top-level `account`, writer and reader would disagree: every
   * such row would store `null`, the staleness query would match nothing, and
   * the check would silently degrade to the last-write-wins on
   * `charges_enabled` a previous security pass closed. So the writer falls back
   * to the same id the reader will use (security review finding).
   */
  const claimAccountId =
    accountId ??
    (event.type === "account.updated"
      ? (accountObjectSchema.safeParse(event.data.object).data?.id ?? null)
      : null);

  // The only observability this endpoint has: one line per delivery naming the
  // event id/type/connected account, and one more per outcome below —
  // including a `null`/refused handler result, which is otherwise a silent
  // 200 with no trace anywhere (docs product/archive/
  // specialist-optimization-audit-20260731.md §7).
  log("stripe_webhook.event_received", "info", {
    eventId: event.id,
    eventType: event.type,
    account: accountId,
  });
  const logOutcome = (outcome: string, extra: LogContext = {}) =>
    log("stripe_webhook.handler_outcome", "info", {
      eventId: event.id,
      eventType: event.type,
      account: accountId,
      outcome,
      ...extra,
    });

  // A live-secret-verified event must carry livemode:true and a
  // test-secret-verified event must carry livemode:false — Stripe's own
  // events always satisfy this by construction. Anything else (including a
  // real event's mode not matching the secret that verified it, or the field
  // being absent) is refused with a 200-and-ignore rather than a non-2xx,
  // since a non-2xx makes Stripe retry the same mismatched event forever.
  const expectedLivemode = verifiedWith === "live";
  if (event.livemode !== expectedLivemode) {
    logOutcome("livemode_mismatch", { verifiedWith, livemode: event.livemode ?? null });
    return new Response(null, { status: 200 });
  }
  // Which charge a reversal is about, asked of Stripe only with a key of this
  // event's own mode (ADR 20261009-stripe-reversals-reach-diveday).
  const sourceLookup = paymentSourceLookupFromEnvironment(process.env, fetch, {
    livemode: expectedLivemode,
  });

  // On a deployment that takes real money, the only test-mode traffic with
  // any business here is the canonical demo's: its checkout runs on the
  // test-mode key (ADR 20261009-demo-test-mode-payments). A test event about
  // any other account, about none, or about the demo's account while anyone
  // but the canonical demo holds it, changes nothing, so a test-mode secret
  // configured for the demo cannot move a real shop's order. "Takes real
  // money" is any sign of it, not the key's prefix alone: a live webhook
  // secret configured, a live platform key, or Vercel's production
  // environment. A deployment that is test mode throughout is unaffected.
  if (verifiedWith === "test" && takesRealMoney()) {
    const demoAccountId = demoStripeAccount()?.accountId;
    const holder =
      demoAccountId && claimAccountId === demoAccountId
        ? await stripeAccountHolder(db, demoAccountId)
        : null;
    if (!holder?.isCanonicalDemo) {
      logOutcome("test_event_outside_demo", { verifiedWith });
      return new Response(null, { status: 200 });
    }
  }

  // Claim this event id before doing anything else: a redelivered event
  // (Stripe's webhooks are at-least-once) is a no-op past this point,
  // independent of whichever handler's own state machine it would have hit
  // (docs ADR 20260719-stripe-connect-orders; security review finding).
  // Belt-and-suspenders — every handler below keeps its own idempotent
  // guards too.
  //
  // Claim *before* handling, never around it: `hasNewerAccountUpdate` is
  // written to read a ledger that already contains the current event (it
  // excludes the event's own id), so reordering the two would break
  // `account.updated`'s only defense against out-of-order delivery. The
  // dispatch below is instead wrapped in a try/catch that gives the claim back
  // when a handler throws (PAY-M1) — release-on-failure rather than one outer
  // transaction around claim+dispatch, because every handler opens its own
  // `db.transaction` and an outer one would nest two-to-three levels of
  // savepoints whose behaviour under PGlite is untested.
  const claimed = await claimStripeWebhookEvent(db, {
    id: event.id,
    type: event.type,
    account: claimAccountId,
    occurredAt,
  });
  if (!claimed) {
    logOutcome("duplicate_event");
    return new Response(null, { status: 200 });
  }

  // Set by a handler that cannot apply this event *yet* — DiveDay's own refund
  // of the same money is mid-flight, or the payment it reverses has not
  // settled here. Answered like a failure (claim given back, non-2xx) so Stripe
  // delivers it again, but without paging anyone: nothing is wrong.
  let deferred = false;
  try {
    switch (event.type) {
      case "invoice.paid": {
        const invoice = invoiceObjectSchema.safeParse(event.data.object);
        if (invoice.success) {
          const order = await markOrderPaidByInvoiceId(
            db,
            invoice.data.id,
            invoice.data.amount_paid ?? 0,
            event.account,
            invoiceTaxCents(invoice.data),
          );
          logOutcome(order ? "order_paid" : "order_not_found");
          const paymentIntentId = order ? invoicePaymentIntentId(event.data.object) : null;
          if (paymentIntentId) {
            await recordOrderPaymentIntent(db, {
              stripeInvoiceId: invoice.data.id,
              paymentIntentId,
              expectedAccountId: event.account,
            });
          }
          // A paid order enqueues `order.paid` for every connected
          // integration. Stripe's webhook is the most common way an order
          // becomes paid, so draining here is what makes the write-driven
          // path worth having at all (ADR
          // 20260919-integration-delivery-is-write-driven). After the 200
          // below, never before it: Stripe retries on a slow response, and a
          // provider's latency must not become a redelivery.
          if (order) dispatchIntegrationsAfterResponse();
        } else {
          logOutcome("malformed_payload");
        }
        break;
      }
      case "invoice.voided": {
        const invoice = invoiceObjectSchema.safeParse(event.data.object);
        if (invoice.success) {
          const order = await markOrderVoidedByInvoiceId(db, invoice.data.id, event.account);
          logOutcome(order ? "order_voided" : "order_not_found");
        } else {
          logOutcome("malformed_payload");
        }
        break;
      }
      case "checkout.session.completed": {
        const session = checkoutSessionObjectSchema.safeParse(event.data.object);
        if (session.success) {
          await recordSessionCustomer(db, session.data, event.account, logOutcome);
          await recordSessionPaymentIntent(db, session.data, event.account, logOutcome);
        }
        // "completed" alone is not "paid": async payment methods complete the
        // session before the money settles. Only Stripe saying paid clears the
        // booking payment gate (docs ADR 20260721-checkout-at-booking).
        if (session.success && session.data.payment_status === "paid") {
          // A tip and a booking checkout share the Stripe session id space but
          // live in separate tables (docs ADR 20260726-post-trip-tipping); a
          // session id belongs to at most one, so try the booking-payment path
          // first and only fall back to tips when it finds nothing to mark.
          const checkout = await markCheckoutPaidBySessionId(
            db,
            session.data.id,
            event.account,
            session.data.amount_total,
            session.data.total_details?.amount_tax,
          );
          if (checkout) {
            logOutcome("checkout_paid");
          } else {
            const tip = await markTipPaidBySessionId(db, session.data.id, event.account);
            logOutcome(tip ? "tip_paid" : "session_not_found");
          }
        } else if (session.success) {
          logOutcome("payment_not_settled");
        } else {
          logOutcome("malformed_payload");
        }
        break;
      }
      case "checkout.session.async_payment_succeeded": {
        const session = checkoutSessionObjectSchema.safeParse(event.data.object);
        if (session.success) {
          await recordSessionCustomer(db, session.data, event.account, logOutcome);
          await recordSessionPaymentIntent(db, session.data, event.account, logOutcome);
          const checkout = await markCheckoutPaidBySessionId(
            db,
            session.data.id,
            event.account,
            session.data.amount_total,
            session.data.total_details?.amount_tax,
          );
          if (checkout) {
            logOutcome("checkout_paid");
          } else {
            const tip = await markTipPaidBySessionId(db, session.data.id, event.account);
            logOutcome(tip ? "tip_paid" : "session_not_found");
          }
        } else {
          logOutcome("malformed_payload");
        }
        break;
      }
      case "checkout.session.async_payment_failed": {
        const session = checkoutSessionObjectSchema.safeParse(event.data.object);
        if (session.success) {
          await recordSessionCustomer(db, session.data, event.account, logOutcome);
          // The counterpart to `async_payment_succeeded` above, and previously
          // the gap that left a delayed-notification payment stuck `pending`
          // forever (PAY-L1): the session had already emitted `completed` with
          // `payment_status: "unpaid"`, which settles nothing on purpose, and
          // nothing else ever arrived to close it out.
          //
          // Releases the local pending state without ever regressing settled
          // money: `markCheckoutPaymentFailedBySessionId` only matches a
          // `pending` row and touches no `booking_payments` row at all, so a
          // redelivery, or a failure event racing a completion, is a no-op.
          // Falls back to the tip table on the same session-id space as the
          // completion/expiry handlers do.
          const checkout = await markCheckoutPaymentFailedBySessionId(
            db,
            session.data.id,
            event.account,
          );
          if (checkout) {
            logOutcome("checkout_payment_failed");
          } else {
            const tip = await markTipExpiredBySessionId(db, session.data.id, event.account);
            logOutcome(tip ? "tip_expired" : "session_not_found");
          }
        } else {
          logOutcome("malformed_payload");
        }
        break;
      }
      case "checkout.session.expired": {
        const session = checkoutSessionObjectSchema.safeParse(event.data.object);
        if (session.success) {
          await recordSessionCustomer(db, session.data, event.account, logOutcome);
          const checkout = await markCheckoutExpiredBySessionId(db, session.data.id, event.account);
          if (checkout) {
            logOutcome("checkout_expired");
          } else {
            const tip = await markTipExpiredBySessionId(db, session.data.id, event.account);
            logOutcome(tip ? "tip_expired" : "session_not_found");
          }
        } else {
          logOutcome("malformed_payload");
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
            logOutcome("stale_account_update", { account: account.data.id });
            break;
          }
          await setShopStripeAccountStatus(db, account.data.id, {
            chargesEnabled: account.data.charges_enabled,
            payoutsEnabled: account.data.payouts_enabled,
            detailsSubmitted: account.data.details_submitted,
            defaultCurrency: account.data.default_currency,
          });
          logOutcome("account_updated", { account: account.data.id });
        } else {
          logOutcome("malformed_payload");
        }
        break;
      }
      case "account.application.deauthorized": {
        if (event.account) {
          // Ordered against the shop's own `connected_at`, not applied blind:
          // Stripe retries this event for ~3 days and the claim is given back
          // on a failed handle, so a redelivery that lands *after* the owner
          // has reconnected must not re-disconnect a live account.
          const account = await disconnectShopStripeAccount(db, event.account, {
            deauthorizedAt: occurredAt,
          });
          // A row that is still connected means the shop reconnected after this
          // deauthorization happened, so the update deliberately matched nothing.
          logOutcome(
            account && account.disconnectedAt === null
              ? "stale_account_deauthorization"
              : "account_disconnected",
          );
        } else {
          logOutcome("missing_account");
        }
        break;
      }
      case "charge.refunded": {
        // A refund made anywhere — DiveDay's own, or one somebody made in the
        // shop's Stripe dashboard (ADR 20261009-stripe-reversals-reach-diveday).
        // Reconciled to Stripe's cumulative figure, so DiveDay's own refunds,
        // replays and out-of-order deliveries all add nothing.
        const charge = chargeObjectSchema.safeParse(event.data.object);
        const paymentIntentId = charge.success ? idOf(charge.data.payment_intent) : null;
        if (!charge.success) {
          logOutcome("malformed_payload");
        } else if (!event.account) {
          logOutcome("missing_account");
        } else if (!paymentIntentId) {
          // A charge with no PaymentIntent was never made by DiveDay.
          logOutcome("refund_target_not_found");
        } else {
          const outcome = await recordStripeChargeRefund(
            db,
            {
              stripeAccountId: event.account,
              paymentIntentId,
              amountRefundedCents: charge.data.amount_refunded,
              chargeId: charge.data.id,
              occurredAt,
            },
            sourceLookup,
          );
          if (outcome.status === "deferred") {
            deferred = true;
          } else {
            logOutcome(
              outcome.status === "not_found"
                ? "refund_target_not_found"
                : `refund_${outcome.status}`,
            );
            // An order refund enqueued `order.refunded` for every connected
            // integration; drain it after the 200, as `invoice.paid` does.
            if (outcome.status === "order_refunded") dispatchIntegrationsAfterResponse();
          }
        }
        break;
      }
      case "charge.dispute.created":
      case "charge.dispute.updated":
      case "charge.dispute.closed": {
        const dispute = disputeObjectSchema.safeParse(event.data.object);
        const paymentIntentId = dispute.success ? idOf(dispute.data.payment_intent) : null;
        if (!dispute.success) {
          logOutcome("malformed_payload");
        } else if (!event.account) {
          logOutcome("missing_account");
        } else if (!paymentIntentId) {
          logOutcome("dispute_target_not_found");
        } else {
          const dueBy = dispute.data.evidence_details?.due_by;
          const outcome = await recordStripeDispute(
            db,
            {
              stripeAccountId: event.account,
              eventType: event.type,
              occurredAt,
              dispute: {
                id: dispute.data.id,
                paymentIntentId,
                amountCents: dispute.data.amount,
                currency: dispute.data.currency,
                reason: dispute.data.reason ?? null,
                status: dispute.data.status,
                evidenceDueBy: dueBy ? new Date(dueBy * 1000) : null,
                createdAt: new Date(dispute.data.created * 1000),
              },
            },
            sourceLookup,
          );
          logOutcome(
            outcome.status === "recorded"
              ? "dispute_recorded"
              : outcome.status === "stale"
                ? "stale_dispute_event"
                : "dispute_target_not_found",
          );
        }
        break;
      }
      default:
        // invoice.payment_failed and anything else: no local state change
        // today. (`checkout.session.async_payment_failed` left this branch in
        // PAY-L1 — it has a handler above.)
        logOutcome("unhandled_event_type");
        break;
    }
  } catch (error) {
    // The claim must not outlive a failed handle. Give it back so Stripe's own
    // retry actually re-reaches the handler, and answer non-2xx so Stripe
    // *does* retry rather than marking this delivery done (PAY-M1).
    //
    // Every handler this dispatch can reach is safely re-runnable:
    // `markOrderPaidByInvoiceId`/`markOrderVoidedByInvoiceId` are transactional
    // and transition-gated, `markCheckoutPaidBySessionId` never overwrites a
    // recorded settled total and dedupes its promo redemption,
    // `markTipPaidBySessionId` early-returns once paid, both
    // `*ExpiredBySessionId` and `markCheckoutPaymentFailedBySessionId` only
    // touch a `pending` row,
    // `setShopStripeAccountStatus` is gated by `hasNewerAccountUpdate`, and
    // `disconnectShopStripeAccount` neither moves `disconnectedAt` on a row
    // that is already disconnected nor touches one reconnected since this
    // event's own `created` time, `recordStripeChargeRefund` only ever raises a
    // refunded total to Stripe's cumulative figure, and `recordStripeDispute`
    // upserts one row per dispute ordered by the event's `created` time.
    //
    // The two ordering checks above are what a release must not undermine, and
    // the reason it nulls `claimed_at` instead of deleting the row: the ledger
    // entry is *this* event's evidence for every **other** event's staleness
    // check, not only for its own. A deleted row let a failed newer
    // `account.updated` be overtaken by an older redelivery — fail-open on
    // `charges_enabled` (see `releaseStripeWebhookEventClaim`).
    //
    // Narrow race, accepted: a concurrent redelivery landing between the claim
    // and this release sees the claim, logs `duplicate_event` and returns 200
    // without handling. That delivery is then a no-op — but *this* one answers
    // 5xx, so Stripe retries it, and the retry finds the claim released and
    // runs the handler. The event is delayed, never dropped.
    let released = false;
    try {
      released = await releaseStripeWebhookEventClaim(db, event.id);
    } catch (releaseError) {
      // Never let the release mask the original failure. A claim we could not
      // give back is the one case a redelivery cannot self-heal, so it is
      // reported in its own right.
      Sentry.captureException(releaseError, {
        tags: { stripe_webhook_event_type: event.type, stripe_webhook_stage: "claim_release" },
      });
      log("stripe_webhook.claim_release_failed", "error", {
        eventId: event.id,
        eventType: event.type,
        account: accountId,
      });
    }
    // The original error, unwrapped and unreplaced, is what reaches Sentry.
    Sentry.captureException(error, {
      tags: { stripe_webhook_event_type: event.type, stripe_webhook_stage: "handler" },
    });
    logOutcome("handler_failed", { claimReleased: released });
    return new Response(null, { status: 500 });
  }

  if (deferred) {
    // Released the same way a failed handle releases, for the same reason:
    // the retry must reach the handler. A release that fails is the one case a
    // retry cannot heal, so it is reported like the failure path reports it.
    const released = await releaseStripeWebhookEventClaim(db, event.id).catch((releaseError) => {
      Sentry.captureException(releaseError, {
        tags: { stripe_webhook_event_type: event.type, stripe_webhook_stage: "claim_release" },
      });
      return false;
    });
    logOutcome("deferred", { claimReleased: released });
    return new Response(null, { status: 503 });
  }

  return new Response(null, { status: 200 });
}

/** Whether this deployment moves real money: any one sign is enough. */
function takesRealMoney(): boolean {
  return (
    Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim()) ||
    platformKeyIsLive() ||
    process.env.VERCEL_ENV === "production"
  );
}
