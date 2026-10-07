import { z } from "zod";
import type { StripeWebhookEvent } from "@/lib/payments/webhook";
import { STRIPE_SUBSCRIPTION_STATUSES, type StripeSubscriptionStatus } from "./standing";

/**
 * What one verified Stripe event on DiveDay's billing account means for a
 * shop's subscription, read without touching a table (ADR
 * 20261007-subscription-billing).
 *
 * Only three kinds of event change anything, and the webhook is the only
 * writer of subscription state — the Billing page never trusts a redirect
 * back from Checkout to say a card was added.
 *
 * Every effect names the Stripe **customer** id, because that is the one key
 * the database resolves a shop by. A `shop_id` read off the event's metadata
 * or `client_reference_id` is carried as a *claim* the applier checks against
 * that resolution, never as the key itself: metadata is written by whoever
 * holds the account's secret key, and a claim that disagrees with the
 * customer's own shop is refused rather than obeyed.
 */

export type BillingEventEffect =
  | {
      kind: "checkout_completed";
      customerId: string;
      subscriptionId: string;
      shopIdClaim: string | null;
    }
  | {
      kind: "subscription_changed";
      customerId: string;
      subscriptionId: string;
      status: StripeSubscriptionStatus;
      currentPeriodEnd: Date | null;
      cancelAtPeriodEnd: boolean;
      shopIdClaim: string | null;
      /** Stripe's own event time — the ordering evidence for out-of-order delivery. */
      occurredAt: Date;
    }
  | {
      kind: "invoice_paid";
      customerId: string;
      subscriptionId: string | null;
      amountPaid: number;
      paidAt: Date;
    }
  | { kind: "ignored"; reason: "unhandled_event_type" | "not_a_subscription_checkout" }
  | { kind: "malformed" };

const expandable = z.union([z.string().min(1), z.object({ id: z.string().min(1) })]);

function idOf(value: z.infer<typeof expandable>): string {
  return typeof value === "string" ? value : value.id;
}

const metadataSchema = z.record(z.string(), z.string()).nullable().optional();

const checkoutSessionSchema = z.object({
  mode: z.string(),
  customer: expandable.nullable().optional(),
  subscription: expandable.nullable().optional(),
  client_reference_id: z.string().nullable().optional(),
});

const subscriptionSchema = z.object({
  id: z.string().min(1),
  customer: expandable,
  status: z.enum(STRIPE_SUBSCRIPTION_STATUSES),
  cancel_at_period_end: z.boolean().optional(),
  // Older API versions carry the period on the subscription; current ones
  // carry it per item. Both are read so a version bump on the account cannot
  // silently blank the next charge date.
  current_period_end: z.number().int().nullable().optional(),
  items: z
    .object({
      data: z.array(z.object({ current_period_end: z.number().int().nullable().optional() })),
    })
    .optional(),
  metadata: metadataSchema,
});

const invoiceSchema = z.object({
  customer: expandable,
  amount_paid: z.number().int().nonnegative(),
  subscription: expandable.nullable().optional(),
  parent: z
    .object({
      subscription_details: z
        .object({ subscription: expandable.nullable().optional() })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  status_transitions: z
    .object({ paid_at: z.number().int().nullable().optional() })
    .nullable()
    .optional(),
});

function fromUnix(seconds: number | null | undefined): Date | null {
  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
}

/**
 * Read one verified event. `fallbackNow` stands in for Stripe's `created` on a
 * hand-built fixture that omits it; a real event always carries one.
 */
export function readBillingEvent(event: StripeWebhookEvent, fallbackNow: Date): BillingEventEffect {
  const occurredAt = fromUnix(event.created) ?? fallbackNow;
  switch (event.type) {
    case "checkout.session.completed": {
      const session = checkoutSessionSchema.safeParse(event.data.object);
      if (!session.success) return { kind: "malformed" };
      if (session.data.mode !== "subscription") {
        return { kind: "ignored", reason: "not_a_subscription_checkout" };
      }
      if (!session.data.customer || !session.data.subscription) return { kind: "malformed" };
      return {
        kind: "checkout_completed",
        customerId: idOf(session.data.customer),
        subscriptionId: idOf(session.data.subscription),
        shopIdClaim: session.data.client_reference_id ?? null,
      };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = subscriptionSchema.safeParse(event.data.object);
      if (!subscription.success) return { kind: "malformed" };
      const data = subscription.data;
      const itemPeriodEnds = (data.items?.data ?? [])
        .map((item) => item.current_period_end)
        .filter((value): value is number => typeof value === "number");
      const periodEnd =
        itemPeriodEnds.length > 0 ? Math.min(...itemPeriodEnds) : data.current_period_end;
      return {
        kind: "subscription_changed",
        customerId: idOf(data.customer),
        subscriptionId: data.id,
        status: data.status,
        currentPeriodEnd: fromUnix(periodEnd),
        cancelAtPeriodEnd: data.cancel_at_period_end ?? false,
        shopIdClaim: data.metadata?.shop_id ?? null,
        occurredAt,
      };
    }
    case "invoice.paid": {
      const invoice = invoiceSchema.safeParse(event.data.object);
      if (!invoice.success) return { kind: "malformed" };
      const data = invoice.data;
      const subscription = data.parent?.subscription_details?.subscription ?? data.subscription;
      return {
        kind: "invoice_paid",
        customerId: idOf(data.customer),
        subscriptionId: subscription ? idOf(subscription) : null,
        amountPaid: data.amount_paid,
        paidAt: fromUnix(data.status_transitions?.paid_at) ?? occurredAt,
      };
    }
    default:
      return { kind: "ignored", reason: "unhandled_event_type" };
  }
}
