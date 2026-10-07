import * as Sentry from "@sentry/nextjs";
import type { AppDb } from "@/db/client";
import { getDb } from "@/db/client";
import { applyBillingEffect } from "@/db/shop-subscriptions";
import { claimStripeWebhookEvent, releaseStripeWebhookEventClaim } from "@/db/webhook-events";
import { readBillingEvent } from "@/lib/billing/events";
import {
  BILLING_LEDGER_PREFIX,
  billingConfigFromEnvironment,
  billingKeyIsLive,
} from "@/lib/billing/stripe-billing";
import { nowDate } from "@/lib/clock";
import { type LogContext, log } from "@/lib/log";
import { verifyStripeWebhook } from "@/lib/payments/webhook";

/**
 * DiveDay's own subscription webhook: what a shop pays DiveDay, on DiveDay's
 * own Stripe account, kept apart from the Connect endpoint at
 * `/api/webhooks/stripe` in its route, its secret, and its key.
 *
 * The same five steps as that endpoint, in the same order and for the same
 * reasons:
 *
 * 1. Not configured → 503, so Stripe retries once somebody configures it
 *    rather than marking deliveries done that were never read.
 * 2. Signature and timestamp checked against `BILLING_STRIPE_WEBHOOK_SECRET`
 *    before the body is trusted; any failure is a 400.
 * 3. An event whose `livemode` disagrees with the configured key is
 *    acknowledged and ignored — a correctly signed test event must never
 *    move a live subscription.
 * 4. The event id is claimed in the ledger before anything is handled, so a
 *    replay is a no-op; a handler that throws gives the claim back and answers
 *    500, so Stripe's retry really retries.
 * 5. Every outcome, including every refusal, is one log line.
 */
export async function POST(request: Request) {
  const config = billingConfigFromEnvironment();
  if (!config) return new Response(null, { status: 503 });

  const payload = await request.text();
  const verification = verifyStripeWebhook(
    payload,
    request.headers.get("stripe-signature"),
    config.webhookSecret,
  );
  if (verification.status === "not_configured") return new Response(null, { status: 503 });
  if (verification.status !== "verified") return new Response(null, { status: 400 });

  const { event } = verification;
  log("billing_webhook.event_received", "info", { eventId: event.id, eventType: event.type });
  const logOutcome = (outcome: string, extra: LogContext = {}) =>
    log("billing_webhook.handler_outcome", "info", {
      eventId: event.id,
      eventType: event.type,
      outcome,
      ...extra,
    });

  if (event.livemode !== billingKeyIsLive(config)) {
    logOutcome("livemode_mismatch", { livemode: event.livemode ?? null });
    return new Response(null, { status: 200 });
  }

  const db = await getDb();
  const receivedAt = nowDate();
  const ledgerId = `${BILLING_LEDGER_PREFIX}${event.id}`;
  const claimed = await claimStripeWebhookEvent(db, {
    id: ledgerId,
    type: event.type,
    account: null,
    occurredAt: event.created !== undefined ? new Date(event.created * 1000) : receivedAt,
  });
  if (!claimed) {
    logOutcome("duplicate_event");
    return new Response(null, { status: 200 });
  }

  try {
    await handle(db, event, receivedAt, logOutcome);
  } catch (error) {
    let released = false;
    try {
      released = await releaseStripeWebhookEventClaim(db, ledgerId);
    } catch (releaseError) {
      Sentry.captureException(releaseError, {
        tags: { billing_webhook_event_type: event.type, billing_webhook_stage: "claim_release" },
      });
    }
    Sentry.captureException(error, {
      tags: { billing_webhook_event_type: event.type, billing_webhook_stage: "handler" },
    });
    logOutcome("handler_failed", { claimReleased: released });
    return new Response(null, { status: 500 });
  }
  return new Response(null, { status: 200 });
}

async function handle(
  db: AppDb,
  event: Parameters<typeof readBillingEvent>[0],
  receivedAt: Date,
  logOutcome: (outcome: string, extra?: LogContext) => void,
): Promise<void> {
  const effect = readBillingEvent(event, receivedAt);
  if (effect.kind === "ignored") {
    logOutcome(effect.reason);
    return;
  }
  const outcome = await applyBillingEffect(db, effect);
  const customer = effect.kind === "malformed" ? null : effect.customerId;
  if (outcome === "first_paid") {
    // The "first paid month" milestone, as an event a log reader can count.
    // The durable record is `shop_subscriptions.first_paid_at`.
    log("billing.first_paid_month", "info", { eventId: event.id, customer });
  }
  // A refusal that a person should look at is a warning, not routine.
  const needsAPerson =
    outcome === "tenant_mismatch" ||
    outcome === "foreign_subscription" ||
    outcome === "subscription_claimed_elsewhere" ||
    outcome === "customer_not_found";
  if (needsAPerson) {
    log("billing_webhook.refused", "warn", {
      eventId: event.id,
      eventType: event.type,
      outcome,
      customer,
    });
  }
  logOutcome(outcome, { customer });
}
