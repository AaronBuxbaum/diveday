import { describe, expect, it } from "vitest";
import type { StripeWebhookEvent } from "@/lib/payments/webhook";
import { readBillingEvent } from "./events";

const NOW = new Date("2026-10-07T12:00:00.000Z");
const CREATED = 1_791_374_400; // 2026-10-07T12:00:00Z, Stripe's unix seconds

function event(type: string, object: Record<string, unknown>): StripeWebhookEvent {
  return { id: "evt_1", type, created: CREATED, livemode: false, data: { object } };
}

describe("readBillingEvent", () => {
  it("reads a subscription Checkout as a link from customer to subscription, with the shop as a claim", () => {
    expect(
      readBillingEvent(
        event("checkout.session.completed", {
          mode: "subscription",
          customer: "cus_1",
          subscription: { id: "sub_1" },
          client_reference_id: "shop-1",
        }),
        NOW,
      ),
    ).toEqual({
      kind: "checkout_completed",
      customerId: "cus_1",
      subscriptionId: "sub_1",
      shopIdClaim: "shop-1",
    });
  });

  it("ignores a one-off payment Checkout on the same account", () => {
    expect(readBillingEvent(event("checkout.session.completed", { mode: "payment" }), NOW)).toEqual(
      { kind: "ignored", reason: "not_a_subscription_checkout" },
    );
  });

  it("reads the period end from the items, where current API versions put it", () => {
    const effect = readBillingEvent(
      event("customer.subscription.updated", {
        id: "sub_1",
        customer: "cus_1",
        status: "active",
        cancel_at_period_end: true,
        items: { data: [{ current_period_end: CREATED + 86_400 }] },
        metadata: { shop_id: "shop-1" },
      }),
      NOW,
    );
    expect(effect).toEqual({
      kind: "subscription_changed",
      customerId: "cus_1",
      subscriptionId: "sub_1",
      status: "active",
      currentPeriodEnd: new Date((CREATED + 86_400) * 1000),
      cancelAtPeriodEnd: true,
      shopIdClaim: "shop-1",
      occurredAt: new Date(CREATED * 1000),
    });
  });

  it("falls back to the subscription's own period end on an older API version", () => {
    const effect = readBillingEvent(
      event("customer.subscription.created", {
        id: "sub_1",
        customer: "cus_1",
        status: "trialing",
        current_period_end: CREATED + 60,
      }),
      NOW,
    );
    expect(effect).toMatchObject({
      kind: "subscription_changed",
      currentPeriodEnd: new Date((CREATED + 60) * 1000),
      cancelAtPeriodEnd: false,
      shopIdClaim: null,
    });
  });

  it("refuses a status Stripe has not told us about rather than guessing", () => {
    expect(
      readBillingEvent(
        event("customer.subscription.updated", {
          id: "sub_1",
          customer: "cus_1",
          status: "frozen",
        }),
        NOW,
      ),
    ).toEqual({ kind: "malformed" });
  });

  it("reads a paid invoice's subscription from either API shape", () => {
    const current = readBillingEvent(
      event("invoice.paid", {
        customer: "cus_1",
        amount_paid: 9_900,
        parent: { subscription_details: { subscription: "sub_1" } },
        status_transitions: { paid_at: CREATED + 5 },
      }),
      NOW,
    );
    expect(current).toEqual({
      kind: "invoice_paid",
      customerId: "cus_1",
      subscriptionId: "sub_1",
      amountPaid: 9_900,
      paidAt: new Date((CREATED + 5) * 1000),
    });
    const older = readBillingEvent(
      event("invoice.paid", { customer: "cus_1", amount_paid: 0, subscription: "sub_1" }),
      NOW,
    );
    expect(older).toMatchObject({ subscriptionId: "sub_1", paidAt: new Date(CREATED * 1000) });
  });

  it("ignores a paid invoice that belongs to no subscription", () => {
    expect(
      readBillingEvent(event("invoice.paid", { customer: "cus_1", amount_paid: 5_000 }), NOW),
    ).toEqual({ kind: "ignored", reason: "not_a_subscription_invoice" });
  });

  it("ignores everything else", () => {
    expect(readBillingEvent(event("charge.refunded", {}), NOW)).toEqual({
      kind: "ignored",
      reason: "unhandled_event_type",
    });
  });

  it("calls a payload missing its customer malformed", () => {
    expect(readBillingEvent(event("invoice.paid", { amount_paid: 1 }), NOW)).toEqual({
      kind: "malformed",
    });
  });
});
