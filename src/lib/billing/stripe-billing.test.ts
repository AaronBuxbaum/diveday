import { describe, expect, it, vi } from "vitest";
import {
  billingConfigFromEnvironment,
  billingKeyIsLive,
  billingProviderFromEnvironment,
  CHECKOUT_MIN_TRIAL_MS,
  checkoutTrialEnd,
  stripeBillingProvider,
} from "./stripe-billing";

const ENV = {
  BILLING_STRIPE_SECRET_KEY: "sk_test_billing",
  BILLING_STRIPE_WEBHOOK_SECRET: "whsec_billing",
  BILLING_STRIPE_PRICE_ID: "price_monthly",
};
const CONFIG = {
  secretKey: "sk_test_billing",
  webhookSecret: "whsec_billing",
  priceId: "price_monthly",
};
const NOW = new Date("2026-10-07T12:00:00.000Z");

function fakeFetch(status: number, body: unknown) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  );
}

function sentBody(fetchMock: ReturnType<typeof fakeFetch>): URLSearchParams {
  return new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body ?? ""));
}

describe("billingConfigFromEnvironment", () => {
  it("is null when nothing is set — billing is not turned on", () => {
    expect(billingConfigFromEnvironment({})).toBeNull();
    expect(billingProviderFromEnvironment({})).toBeNull();
  });

  it.each(Object.keys(ENV))("is null when %s alone is missing", (key) => {
    expect(billingConfigFromEnvironment({ ...ENV, [key]: undefined })).toBeNull();
  });

  it("is null when a value has the wrong shape", () => {
    expect(
      billingConfigFromEnvironment({ ...ENV, BILLING_STRIPE_PRICE_ID: "prod_123" }),
    ).toBeNull();
    expect(
      billingConfigFromEnvironment({ ...ENV, BILLING_STRIPE_SECRET_KEY: "pk_live_x" }),
    ).toBeNull();
  });

  it("never reads the Connect variables", () => {
    expect(
      billingConfigFromEnvironment({
        STRIPE_SECRET_KEY: "sk_live_connect",
        STRIPE_WEBHOOK_SECRET: "whsec_connect",
      }),
    ).toBeNull();
  });

  it("refuses the Connect key pasted into the billing slot", () => {
    expect(
      billingConfigFromEnvironment({ ...ENV, STRIPE_SECRET_KEY: ENV.BILLING_STRIPE_SECRET_KEY }),
    ).toBeNull();
    expect(billingConfigFromEnvironment({ ...ENV, STRIPE_SECRET_KEY: "sk_test_connect" })).toEqual(
      CONFIG,
    );
  });

  it("reads all three together", () => {
    expect(billingConfigFromEnvironment(ENV)).toEqual(CONFIG);
  });
});

describe("billingKeyIsLive", () => {
  it("follows the key's own mode, restricted keys included", () => {
    expect(billingKeyIsLive(CONFIG)).toBe(false);
    expect(billingKeyIsLive({ ...CONFIG, secretKey: "sk_live_x" })).toBe(true);
    expect(billingKeyIsLive({ ...CONFIG, secretKey: "rk_live_x" })).toBe(true);
  });
});

describe("checkoutTrialEnd", () => {
  it("charges at once when there is no free time left", () => {
    expect(checkoutTrialEnd(null, NOW)).toBeNull();
    expect(checkoutTrialEnd(new Date(NOW.getTime() - 1), NOW)).toBeNull();
  });

  it("defers the first charge to the end of the free time", () => {
    const end = new Date("2027-04-02T04:00:00.000Z");
    expect(checkoutTrialEnd(end, NOW)).toBe(end.getTime() / 1000);
  });

  it("never asks Stripe for a trial shorter than Checkout accepts", () => {
    const tomorrow = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    expect(checkoutTrialEnd(tomorrow, NOW)).toBe(
      Math.ceil((NOW.getTime() + CHECKOUT_MIN_TRIAL_MS) / 1000),
    );
  });
});

describe("stripeBillingProvider", () => {
  it("mints one customer per shop, idempotently, tagged with the shop", async () => {
    const fetchMock = fakeFetch(200, { id: "cus_123" });
    const provider = stripeBillingProvider(CONFIG, fetchMock as never);
    const result = await provider.createCustomer({
      shopId: "shop-1",
      shopName: "Blue Mantis",
      email: "owner@example.com",
    });
    expect(result).toEqual({ status: "ok", value: "cus_123" });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.stripe.com/v1/customers");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["Idempotency-Key"]).toMatch(/^diveday-billing-customer-shop-1-[0-9a-f]{16}$/);
    expect(headers.Authorization).toBe("Bearer sk_test_billing");
    expect(sentBody(fetchMock).get("metadata[shop_id]")).toBe("shop-1");
  });

  it("keys a customer by its parameters too, so a changed name is a new request, not a reused key", async () => {
    const fetchMock = fakeFetch(200, { id: "cus_123" });
    const provider = stripeBillingProvider(CONFIG, fetchMock as never);
    const key = async (shopName: string) => {
      await provider.createCustomer({ shopId: "shop-1", shopName, email: null });
      const init = fetchMock.mock.calls.at(-1)?.[1];
      return ((init?.headers ?? {}) as Record<string, string>)["Idempotency-Key"];
    };
    const first = await key("Blue Mantis");
    expect(await key("Blue Mantis")).toBe(first);
    expect(await key("Blue Mantis Dive")).not.toBe(first);
  });

  it("opens a subscription Checkout for the one price, bound to the shop and its customer", async () => {
    const fetchMock = fakeFetch(200, { id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" });
    const provider = stripeBillingProvider(CONFIG, fetchMock as never);
    const end = new Date("2027-04-02T04:00:00.000Z");
    const result = await provider.createCheckoutSession({
      shopId: "shop-1",
      customerId: "cus_123",
      successUrl: "https://dive.day/shop/x/settings/billing?notice=card-added",
      cancelUrl: "https://dive.day/shop/x/settings/billing",
      firstChargeAt: end,
      now: NOW,
    });
    expect(result).toEqual({
      status: "ok",
      value: { id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" },
    });
    const body = sentBody(fetchMock);
    expect(body.get("mode")).toBe("subscription");
    expect(body.get("customer")).toBe("cus_123");
    expect(body.get("client_reference_id")).toBe("shop-1");
    expect(body.get("line_items[0][price]")).toBe("price_monthly");
    expect(body.get("subscription_data[metadata][shop_id]")).toBe("shop-1");
    expect(body.get("subscription_data[trial_end]")).toBe(String(end.getTime() / 1000));
  });

  it("settles the last Checkout session: expires an open one, reports a completed one", async () => {
    const answers = (...bodies: unknown[]) => {
      const fetchMock = vi.fn(
        async (_url: string | URL | Request, _init?: RequestInit) =>
          new Response(JSON.stringify(bodies.shift()), { status: 200 }),
      );
      return { fetchMock, provider: stripeBillingProvider(CONFIG, fetchMock as never) };
    };
    const open = answers({ status: "open" }, { status: "expired" });
    expect(await open.provider.settleCheckoutSession("cs_1")).toEqual({
      status: "ok",
      value: "cleared",
    });
    expect(open.fetchMock.mock.calls[1]?.[0]).toBe(
      "https://api.stripe.com/v1/checkout/sessions/cs_1/expire",
    );
    const done = answers({ status: "complete" });
    expect(await done.provider.settleCheckoutSession("cs_1")).toEqual({
      status: "ok",
      value: "completed",
    });
    expect(done.fetchMock).toHaveBeenCalledTimes(1);
    const gone = answers({ status: "expired" });
    expect(await gone.provider.settleCheckoutSession("cs_1")).toEqual({
      status: "ok",
      value: "cleared",
    });
    // The owner paid in the other tab between the read and the expire.
    const raced = answers({ status: "open" }, { error: {} }, { status: "complete" });
    expect(await raced.provider.settleCheckoutSession("cs_1")).toEqual({
      status: "ok",
      value: "completed",
    });
  });

  it("opens the Portal on its cancel confirmation when asked to cancel", async () => {
    const fetchMock = fakeFetch(200, { url: "https://billing.stripe.com/p/session/1" });
    const provider = stripeBillingProvider(CONFIG, fetchMock as never);
    await provider.createPortalSession({
      customerId: "cus_123",
      returnUrl: "https://dive.day/back",
      cancelSubscriptionId: "sub_1",
    });
    const body = sentBody(fetchMock);
    expect(body.get("flow_data[type]")).toBe("subscription_cancel");
    expect(body.get("flow_data[subscription_cancel][subscription]")).toBe("sub_1");
  });

  it("answers failed, never throws, on a refusal, a network error, a non-https URL or a strange body", async () => {
    const refused = stripeBillingProvider(CONFIG, fakeFetch(402, { error: {} }) as never);
    expect(await refused.createCustomer({ shopId: "s", shopName: "n", email: null })).toEqual({
      status: "failed",
    });
    const offline = stripeBillingProvider(CONFIG, (async () => {
      throw new Error("offline");
    }) as never);
    expect(await offline.createPortalSession({ customerId: "c", returnUrl: "https://x" })).toEqual({
      status: "failed",
    });
    const plain = stripeBillingProvider(
      CONFIG,
      fakeFetch(200, { url: "http://billing.stripe.com/p/1" }) as never,
    );
    expect(await plain.createPortalSession({ customerId: "c", returnUrl: "https://x" })).toEqual({
      status: "failed",
    });
    const odd = stripeBillingProvider(CONFIG, fakeFetch(200, { url: "not a url" }) as never);
    expect(
      await odd.createCheckoutSession({
        shopId: "s",
        customerId: "c",
        successUrl: "https://x",
        cancelUrl: "https://x",
        firstChargeAt: null,
        now: NOW,
      }),
    ).toEqual({ status: "failed" });
  });
});
