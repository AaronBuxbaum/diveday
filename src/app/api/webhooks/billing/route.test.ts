import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { shops, stripeWebhookEvents } from "@/db/schema";
import { ensureShopBillingCustomer, getShopSubscription } from "@/db/shop-subscriptions";
import { nowDate, nowMs } from "@/lib/clock";
import { seededShopContext } from "@/test/db";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/shop-subscriptions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/shop-subscriptions")>();
  return { ...actual, applyBillingEffect: vi.fn(actual.applyBillingEffect) };
});
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const { getDb } = await import("@/db/client");
const subscriptions = await import("@/db/shop-subscriptions");
const actualApply = (
  await vi.importActual<typeof import("@/db/shop-subscriptions")>("@/db/shop-subscriptions")
).applyBillingEffect;
const { POST } = await import("./route");

const WEBHOOK_SECRET = "whsec_billing_test";
const CONNECT_SECRET = "whsec_connect_test";

function nowSeconds(): number {
  return Math.floor(nowMs() / 1000);
}

function signed(payload: string, secret = WEBHOOK_SECRET, timestamp = nowSeconds()): string {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

function deliver(payload: string, signature: string | null) {
  const headers: Record<string, string> = {};
  if (signature !== null) headers["stripe-signature"] = signature;
  return POST(
    new Request("http://localhost/api/webhooks/billing", {
      method: "POST",
      headers,
      body: payload,
    }),
  );
}

function subscriptionEvent(
  id: string,
  object: Record<string, unknown>,
  created = nowSeconds(),
): string {
  return JSON.stringify({
    id,
    type: "customer.subscription.updated",
    created,
    livemode: false,
    data: {
      object: {
        id: "sub_a",
        customer: "cus_a",
        status: "active",
        cancel_at_period_end: false,
        items: { data: [{ current_period_end: created + 30 * 86_400 }] },
        ...object,
      },
    },
  });
}

let db: AppDb;
let shopId: string;

beforeEach(async () => {
  const context = await seededShopContext();
  db = context.db;
  shopId = context.shop.id;
  await ensureShopBillingCustomer(db, shopId, "cus_a");
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(subscriptions.applyBillingEffect).mockReset().mockImplementation(actualApply);
  vi.stubEnv("BILLING_STRIPE_SECRET_KEY", "sk_test_billing");
  vi.stubEnv("BILLING_STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
  vi.stubEnv("BILLING_STRIPE_PRICE_ID", "price_monthly");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", CONNECT_SECRET);
});

describe("POST /api/webhooks/billing — refuses before it reads", () => {
  it("answers 503 while billing is not turned on, and writes nothing", async () => {
    vi.stubEnv("BILLING_STRIPE_SECRET_KEY", "");
    vi.stubEnv("BILLING_STRIPE_WEBHOOK_SECRET", "");
    vi.stubEnv("BILLING_STRIPE_PRICE_ID", "");
    const payload = subscriptionEvent("evt_off", {});
    const response = await deliver(payload, signed(payload));
    expect(response.status).toBe(503);
    expect((await getShopSubscription(db, shopId))?.stripeStatus).toBeNull();
  });

  it("answers 400 on a missing signature, a wrong one, and one signed with the Connect secret", async () => {
    const payload = subscriptionEvent("evt_forged", {});
    expect((await deliver(payload, null)).status).toBe(400);
    expect((await deliver(payload, "t=1,v1=deadbeef")).status).toBe(400);
    expect((await deliver(payload, signed(payload, CONNECT_SECRET))).status).toBe(400);
    expect(subscriptions.applyBillingEffect).not.toHaveBeenCalled();
    expect((await getShopSubscription(db, shopId))?.stripeStatus).toBeNull();
  });

  it("answers 400 on a correctly signed event replayed outside the five-minute window", async () => {
    const stale = nowSeconds() - 600;
    const payload = subscriptionEvent("evt_replayed", {}, stale);
    expect((await deliver(payload, signed(payload, WEBHOOK_SECRET, stale))).status).toBe(400);
    expect(subscriptions.applyBillingEffect).not.toHaveBeenCalled();
  });

  it("acknowledges and ignores a live event when the configured key is a test key", async () => {
    const payload = JSON.stringify({
      ...JSON.parse(subscriptionEvent("evt_live", {})),
      livemode: true,
    });
    expect((await deliver(payload, signed(payload))).status).toBe(200);
    expect(subscriptions.applyBillingEffect).not.toHaveBeenCalled();
    expect((await getShopSubscription(db, shopId))?.stripeStatus).toBeNull();
  });
});

describe("POST /api/webhooks/billing — applies what Stripe says, once", () => {
  it("records the subscription a signed event describes", async () => {
    const payload = subscriptionEvent("evt_1", { status: "trialing" });
    expect((await deliver(payload, signed(payload))).status).toBe(200);
    expect(await getShopSubscription(db, shopId)).toMatchObject({
      stripeSubscriptionId: "sub_a",
      stripeStatus: "trialing",
    });
  });

  it("treats a redelivery of a handled event as a no-op, even after the state moved on", async () => {
    const t = nowSeconds();
    const first = subscriptionEvent("evt_active", { status: "active" }, t - 60);
    const second = subscriptionEvent("evt_canceled", { status: "canceled" }, t - 30);
    await deliver(first, signed(first));
    await deliver(second, signed(second));
    // Stripe retries `evt_active` (at-least-once delivery): it must not undo the cancel.
    expect((await deliver(first, signed(first))).status).toBe(200);
    expect(subscriptions.applyBillingEffect).toHaveBeenCalledTimes(2);
    expect((await getShopSubscription(db, shopId))?.stripeStatus).toBe("canceled");
  });

  it("refuses an older event that arrives after a newer one", async () => {
    const t = nowSeconds();
    const newer = subscriptionEvent("evt_newer", { status: "past_due" }, t - 10);
    const older = subscriptionEvent("evt_older", { status: "active" }, t - 100);
    await deliver(newer, signed(newer));
    expect((await deliver(older, signed(older))).status).toBe(200);
    expect((await getShopSubscription(db, shopId))?.stripeStatus).toBe("past_due");
  });

  it("writes nothing when the event's metadata names another shop than the customer's", async () => {
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-billing-route", timezone: "UTC" })
      .returning({ id: shops.id });
    const payload = subscriptionEvent("evt_cross", { metadata: { shop_id: other?.id } });
    expect((await deliver(payload, signed(payload))).status).toBe(200);
    expect((await getShopSubscription(db, shopId))?.stripeStatus).toBeNull();
    expect(await getShopSubscription(db, other?.id ?? "")).toBeNull();
  });

  it("writes nothing for a customer no shop holds", async () => {
    const payload = subscriptionEvent("evt_stranger", { customer: "cus_stranger" });
    expect((await deliver(payload, signed(payload))).status).toBe(200);
    expect((await getShopSubscription(db, shopId))?.stripeStatus).toBeNull();
  });

  it("is never blocked by the Connect endpoint having claimed the same event id", async () => {
    await db.insert(stripeWebhookEvents).values({
      id: "evt_shared",
      type: "customer.subscription.updated",
      account: null,
      occurredAt: nowDate(),
    });
    const payload = subscriptionEvent("evt_shared", { status: "active" });
    expect((await deliver(payload, signed(payload))).status).toBe(200);
    expect((await getShopSubscription(db, shopId))?.stripeStatus).toBe("active");
    const ledger = await db
      .select({ id: stripeWebhookEvents.id })
      .from(stripeWebhookEvents)
      .where(eq(stripeWebhookEvents.id, "billing:evt_shared"));
    expect(ledger).toHaveLength(1);
  });

  it("gives the claim back and answers 500 when handling throws, so Stripe's retry is handled", async () => {
    vi.mocked(subscriptions.applyBillingEffect).mockRejectedValueOnce(new Error("db down"));
    const payload = subscriptionEvent("evt_retry", { status: "active" });
    expect((await deliver(payload, signed(payload))).status).toBe(500);
    expect((await getShopSubscription(db, shopId))?.stripeStatus).toBeNull();
    expect((await deliver(payload, signed(payload))).status).toBe(200);
    expect((await getShopSubscription(db, shopId))?.stripeStatus).toBe("active");
  });

  it("records the first paid month from a paid invoice", async () => {
    const payload = JSON.stringify({
      id: "evt_paid",
      type: "invoice.paid",
      created: nowSeconds(),
      livemode: false,
      data: {
        object: {
          customer: "cus_a",
          amount_paid: 9_900,
          parent: { subscription_details: { subscription: "sub_a" } },
          status_transitions: { paid_at: nowSeconds() },
        },
      },
    });
    expect((await deliver(payload, signed(payload))).status).toBe(200);
    expect((await getShopSubscription(db, shopId))?.firstPaidAt).toBeInstanceOf(Date);
  });
});
