import { describe, expect, it } from "vitest";
import type { BillingEventEffect } from "@/lib/billing/events";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { shops } from "./schema";
import {
  applyBillingEffect,
  ensureShopBillingCustomer,
  getShopSubscription,
  holdsLiveSubscription,
  recordShopCheckoutSession,
  setShopFreeTerm,
  subscriptionSnapshot,
} from "./shop-subscriptions";

const T0 = new Date("2026-10-07T12:00:00.000Z");
const later = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

function changed(
  overrides: Partial<Extract<BillingEventEffect, { kind: "subscription_changed" }>> = {},
): BillingEventEffect {
  return {
    kind: "subscription_changed",
    customerId: "cus_a",
    subscriptionId: "sub_a",
    status: "active",
    currentPeriodEnd: new Date("2026-11-07T12:00:00.000Z"),
    cancelAtPeriodEnd: false,
    shopIdClaim: null,
    occurredAt: T0,
    ...overrides,
  };
}

function completed(
  shopId: string,
  overrides: Partial<Extract<BillingEventEffect, { kind: "checkout_completed" }>> = {},
): BillingEventEffect {
  return {
    kind: "checkout_completed",
    sessionId: "cs_a",
    customerId: "cus_a",
    subscriptionId: "sub_a",
    shopIdClaim: shopId,
    ...overrides,
  };
}

async function otherShop(db: AppDb): Promise<string> {
  const [row] = await db
    .insert(shops)
    .values({ name: "Other Shop", slug: "other-shop-billing", timezone: "UTC" })
    .returning({ id: shops.id });
  if (!row) throw new Error("fixture insert failed");
  return row.id;
}

describe("ensureShopBillingCustomer", () => {
  it("records the customer once and keeps the first one a racing second tap minted", async () => {
    const { db, shop } = await seededShopContext();
    expect(await ensureShopBillingCustomer(db, shop.id, "cus_first")).toBe("cus_first");
    expect(await ensureShopBillingCustomer(db, shop.id, "cus_second")).toBe("cus_first");
    expect((await getShopSubscription(db, shop.id))?.stripeCustomerId).toBe("cus_first");
  });

  it("answers null, writing nothing, for a customer id another shop already holds", async () => {
    const { db, shop } = await seededShopContext();
    const other = await otherShop(db);
    await ensureShopBillingCustomer(db, other, "cus_shared");
    expect(await ensureShopBillingCustomer(db, shop.id, "cus_shared")).toBeNull();
    expect(await getShopSubscription(db, shop.id)).toBeNull();
  });
});

describe("recordShopCheckoutSession", () => {
  it("records a session only over the one the caller settled", async () => {
    const { db, shop } = await seededShopContext();
    await ensureShopBillingCustomer(db, shop.id, "cus_a");
    expect(
      await recordShopCheckoutSession(db, shop.id, { previous: null, sessionId: "cs_1" }),
    ).toBe(true);
    // A second tab that read the row before cs_1 was recorded loses.
    expect(
      await recordShopCheckoutSession(db, shop.id, { previous: null, sessionId: "cs_2" }),
    ).toBe(false);
    expect(
      await recordShopCheckoutSession(db, shop.id, { previous: "cs_1", sessionId: "cs_3" }),
    ).toBe(true);
    expect((await getShopSubscription(db, shop.id))?.stripeCheckoutSessionId).toBe("cs_3");
  });

  it("is cleared by its own checkout.session.completed, and only by its own", async () => {
    const { db, shop } = await seededShopContext();
    await ensureShopBillingCustomer(db, shop.id, "cus_a");
    await recordShopCheckoutSession(db, shop.id, { previous: null, sessionId: "cs_new" });
    await applyBillingEffect(db, completed(shop.id, { sessionId: "cs_old" }));
    expect((await getShopSubscription(db, shop.id))?.stripeCheckoutSessionId).toBe("cs_new");
    await applyBillingEffect(db, completed(shop.id, { sessionId: "cs_new" }));
    expect((await getShopSubscription(db, shop.id))?.stripeCheckoutSessionId).toBeNull();
  });
});

describe("holdsLiveSubscription", () => {
  it("counts a linked subscription with no status yet, and an incomplete one, as live", async () => {
    const { db, shop } = await seededShopContext();
    await ensureShopBillingCustomer(db, shop.id, "cus_a");
    expect(holdsLiveSubscription(await getShopSubscription(db, shop.id))).toBe(false);
    await applyBillingEffect(db, completed(shop.id));
    expect(holdsLiveSubscription(await getShopSubscription(db, shop.id))).toBe(true);
    await applyBillingEffect(db, changed({ status: "incomplete" }));
    expect(holdsLiveSubscription(await getShopSubscription(db, shop.id))).toBe(true);
    await applyBillingEffect(db, changed({ status: "incomplete_expired", occurredAt: later(1) }));
    expect(holdsLiveSubscription(await getShopSubscription(db, shop.id))).toBe(false);
  });
});

describe("applyBillingEffect", () => {
  it("links the subscription from Checkout, then records Stripe's state", async () => {
    const { db, shop } = await seededShopContext();
    await ensureShopBillingCustomer(db, shop.id, "cus_a");
    expect(
      await applyBillingEffect(
        db,
        completed(shop.id, { subscriptionId: "sub_a", shopIdClaim: shop.id }),
      ),
    ).toBe("linked");
    expect(await applyBillingEffect(db, changed({ shopIdClaim: shop.id }))).toBe(
      "subscription_updated",
    );
    const row = await getShopSubscription(db, shop.id);
    expect(subscriptionSnapshot(row)).toEqual({
      status: "active",
      currentPeriodEnd: new Date("2026-11-07T12:00:00.000Z"),
      cancelAtPeriodEnd: false,
    });
  });

  it("accepts the subscription event arriving before Checkout's own", async () => {
    const { db, shop } = await seededShopContext();
    await ensureShopBillingCustomer(db, shop.id, "cus_a");
    expect(await applyBillingEffect(db, changed({ status: "trialing" }))).toBe(
      "subscription_updated",
    );
    expect(
      await applyBillingEffect(
        db,
        completed(shop.id, { subscriptionId: "sub_a", shopIdClaim: shop.id }),
      ),
    ).toBe("linked");
    expect((await getShopSubscription(db, shop.id))?.stripeStatus).toBe("trialing");
  });

  it("refuses an older event delivered after a newer one", async () => {
    const { db, shop } = await seededShopContext();
    await ensureShopBillingCustomer(db, shop.id, "cus_a");
    await applyBillingEffect(db, changed({ status: "canceled", occurredAt: later(60) }));
    expect(await applyBillingEffect(db, changed({ status: "active", occurredAt: T0 }))).toBe(
      "stale_event",
    );
    expect((await getShopSubscription(db, shop.id))?.stripeStatus).toBe("canceled");
  });

  it("applies two events Stripe stamped in the same second, in delivery order", async () => {
    const { db, shop } = await seededShopContext();
    await ensureShopBillingCustomer(db, shop.id, "cus_a");
    await applyBillingEffect(db, changed({ status: "trialing" }));
    expect(await applyBillingEffect(db, changed({ status: "active" }))).toBe(
      "subscription_updated",
    );
  });

  it("never lets Checkout's event undo the state a subscription event already wrote", async () => {
    const { db, shop } = await seededShopContext();
    await ensureShopBillingCustomer(db, shop.id, "cus_a");
    // subscription.created lands first, then Checkout, then subscription.updated.
    await applyBillingEffect(db, changed({ status: "trialing", occurredAt: T0 }));
    expect(await applyBillingEffect(db, completed(shop.id))).toBe("linked");
    expect(await getShopSubscription(db, shop.id)).toMatchObject({
      stripeSubscriptionId: "sub_a",
      stripeStatus: "trialing",
      lastSubscriptionEventAt: T0,
    });
    // An older updated event must still be refused: Checkout reset no clock.
    expect(
      await applyBillingEffect(db, changed({ status: "incomplete", occurredAt: later(-30) })),
    ).toBe("stale_event");
    expect((await getShopSubscription(db, shop.id))?.stripeStatus).toBe("trialing");
  });

  it("keeps a subscription ended when a live status shares its second, in either order", async () => {
    const { db, shop } = await seededShopContext();
    await ensureShopBillingCustomer(db, shop.id, "cus_a");
    await applyBillingEffect(db, changed({ status: "canceled", occurredAt: T0 }));
    expect(await applyBillingEffect(db, changed({ status: "active", occurredAt: T0 }))).toBe(
      "stale_event",
    );
    expect((await getShopSubscription(db, shop.id))?.stripeStatus).toBe("canceled");
    // Another ended status may still follow.
    expect(
      await applyBillingEffect(db, changed({ status: "incomplete_expired", occurredAt: T0 })),
    ).toBe("subscription_updated");
  });

  it("writes nothing when the event's shop claim names a different shop than the customer's", async () => {
    const { db, shop } = await seededShopContext();
    const other = await otherShop(db);
    await ensureShopBillingCustomer(db, shop.id, "cus_a");
    expect(await applyBillingEffect(db, changed({ shopIdClaim: other }))).toBe("tenant_mismatch");
    expect(
      await applyBillingEffect(
        db,
        completed(shop.id, { subscriptionId: "sub_a", shopIdClaim: other }),
      ),
    ).toBe("tenant_mismatch");
    expect(subscriptionSnapshot(await getShopSubscription(db, shop.id))).toBeNull();
    expect(await getShopSubscription(db, other)).toBeNull();
  });

  it("answers customer_not_found for a customer DiveDay never minted", async () => {
    const { db } = await seededShopContext();
    expect(await applyBillingEffect(db, changed({ customerId: "cus_unknown" }))).toBe(
      "customer_not_found",
    );
  });

  it("refuses a second live subscription and keeps the first", async () => {
    const { db, shop } = await seededShopContext();
    await ensureShopBillingCustomer(db, shop.id, "cus_a");
    await applyBillingEffect(db, changed());
    expect(await applyBillingEffect(db, changed({ subscriptionId: "sub_b" }))).toBe(
      "foreign_subscription",
    );
    expect(
      await applyBillingEffect(
        db,
        completed(shop.id, { subscriptionId: "sub_b", shopIdClaim: shop.id }),
      ),
    ).toBe("foreign_subscription");
    expect((await getShopSubscription(db, shop.id))?.stripeSubscriptionId).toBe("sub_a");
  });

  it("adopts a new subscription once the old one ended, and ignores the old one's late events", async () => {
    const { db, shop } = await seededShopContext();
    await ensureShopBillingCustomer(db, shop.id, "cus_a");
    await applyBillingEffect(db, changed({ status: "canceled", occurredAt: later(10) }));
    expect(
      await applyBillingEffect(
        db,
        changed({ subscriptionId: "sub_b", status: "active", occurredAt: later(5) }),
      ),
    ).toBe("subscription_updated");
    expect(
      await applyBillingEffect(db, changed({ status: "canceled", occurredAt: later(20) })),
    ).toBe("foreign_subscription");
    const row = await getShopSubscription(db, shop.id);
    expect(row?.stripeSubscriptionId).toBe("sub_b");
    expect(row?.stripeStatus).toBe("active");
  });

  it("will not let one shop claim a subscription id another shop holds", async () => {
    const { db, shop } = await seededShopContext();
    const other = await otherShop(db);
    await ensureShopBillingCustomer(db, other, "cus_other");
    await applyBillingEffect(db, changed({ customerId: "cus_other", subscriptionId: "sub_x" }));
    await ensureShopBillingCustomer(db, shop.id, "cus_a");
    expect(await applyBillingEffect(db, changed({ subscriptionId: "sub_x" }))).toBe(
      "subscription_claimed_elsewhere",
    );
    expect(await getShopSubscription(db, shop.id)).toMatchObject({ stripeSubscriptionId: null });
  });

  it("counts only an invoice of the subscription the shop holds", async () => {
    const { db, shop } = await seededShopContext();
    await ensureShopBillingCustomer(db, shop.id, "cus_a");
    const paid = (subscriptionId: string): BillingEventEffect => ({
      kind: "invoice_paid",
      customerId: "cus_a",
      subscriptionId,
      amountPaid: 9_900,
      paidAt: T0,
    });
    expect(await applyBillingEffect(db, paid("sub_a"))).toBe("subscription_not_linked");
    await applyBillingEffect(db, completed(shop.id));
    expect(await applyBillingEffect(db, paid("sub_other"))).toBe("foreign_subscription");
    expect((await getShopSubscription(db, shop.id))?.firstPaidAt).toBeNull();
    expect(await applyBillingEffect(db, paid("sub_a"))).toBe("first_paid");
  });

  it("records the first paid month once, and not for a zero invoice", async () => {
    const { db, shop } = await seededShopContext();
    await ensureShopBillingCustomer(db, shop.id, "cus_a");
    await applyBillingEffect(db, completed(shop.id));
    const paid = (amountPaid: number, paidAt: Date): BillingEventEffect => ({
      kind: "invoice_paid",
      customerId: "cus_a",
      subscriptionId: "sub_a",
      amountPaid,
      paidAt,
    });
    expect(await applyBillingEffect(db, paid(0, T0))).toBe("zero_amount");
    expect((await getShopSubscription(db, shop.id))?.firstPaidAt).toBeNull();
    expect(await applyBillingEffect(db, paid(9_900, later(100)))).toBe("first_paid");
    expect(await applyBillingEffect(db, paid(9_900, later(9_000)))).toBe("already_paid");
    expect((await getShopSubscription(db, shop.id))?.firstPaidAt).toEqual(later(100));
  });

  it("passes ignored and malformed events through without a read", async () => {
    const { db } = await seededShopContext();
    expect(await applyBillingEffect(db, { kind: "ignored", reason: "unhandled_event_type" })).toBe(
      "ignored",
    );
    expect(await applyBillingEffect(db, { kind: "malformed" })).toBe("malformed");
  });
});

describe("setShopFreeTerm", () => {
  it("grants, moves and withdraws a free term by slug", async () => {
    const { db, shop } = await seededShopContext();
    expect(await setShopFreeTerm(db, { shopSlug: shop.slug, endsOn: "2027-04-01" })).toEqual({
      status: "set",
      shopId: shop.id,
      hasLiveSubscription: false,
    });
    expect((await getShopSubscription(db, shop.id))?.freeTermEndsOn).toBe("2027-04-01");
    await setShopFreeTerm(db, { shopSlug: shop.slug, endsOn: null });
    expect((await getShopSubscription(db, shop.id))?.freeTermEndsOn).toBeNull();
  });

  it("keeps the customer it finds and says when Stripe already holds the charge date", async () => {
    const { db, shop } = await seededShopContext();
    await ensureShopBillingCustomer(db, shop.id, "cus_a");
    await applyBillingEffect(db, changed({ status: "trialing" }));
    const outcome = await setShopFreeTerm(db, { shopSlug: shop.slug, endsOn: "2027-04-01" });
    expect(outcome).toMatchObject({ status: "set", hasLiveSubscription: true });
    expect((await getShopSubscription(db, shop.id))?.stripeCustomerId).toBe("cus_a");
  });

  it("refuses an unknown shop and an impossible date", async () => {
    const { db, shop } = await seededShopContext();
    expect(await setShopFreeTerm(db, { shopSlug: "no-such-shop", endsOn: "2027-01-01" })).toEqual({
      status: "no_such_shop",
    });
    expect(await setShopFreeTerm(db, { shopSlug: shop.slug, endsOn: "2027-02-30" })).toEqual({
      status: "invalid_date",
    });
  });
});
