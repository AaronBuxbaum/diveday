import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PRICING_CONFIG, termsFor } from "./pricing-plans";
import {
  billingConfigFromEnvironment,
  billingKeyIsLive,
  billingProviderFromEnvironment,
  CHECKOUT_MIN_TRIAL_MS,
  type CheckoutLine,
  checkoutLines,
  checkoutTrialEnd,
  percentBillingFromEnvironment,
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
const TODAY: CheckoutLine[] = [{ kind: "price", priceId: "price_monthly", metered: false }];
const PERCENT = { priceId: "price_metered", meterEventName: "diveday_fee_cents" };

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
      lines: TODAY,
      customerId: "cus_123",
      successUrl: "https://dive.day/shop/x/settings/billing?notice=card-added",
      cancelUrl: "https://dive.day/shop/x/settings/billing",
      firstChargeAt: end,
      now: NOW,
      replaces: null,
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

  it("keys a Checkout by shop, what is sent and the session it replaces", async () => {
    // Unkeyed, a press whose answer timed out and was pressed again opened a
    // second live session for one subscription (layer B security review).
    const fetchMock = fakeFetch(200, { id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" });
    const provider = stripeBillingProvider(CONFIG, fetchMock as never);
    const key = async (overrides: { replaces?: string | null; firstChargeAt?: Date | null }) => {
      await provider.createCheckoutSession({
        shopId: "shop-1",
        lines: TODAY,
        customerId: "cus_123",
        successUrl: "https://dive.day/ok",
        cancelUrl: "https://dive.day/back",
        firstChargeAt: new Date("2027-04-02T04:00:00.000Z"),
        now: NOW,
        replaces: null,
        ...overrides,
      });
      const init = fetchMock.mock.calls.at(-1)?.[1];
      return ((init?.headers ?? {}) as Record<string, string>)["Idempotency-Key"];
    };
    const first = await key({});
    expect(first).toMatch(/^diveday-billing-checkout-shop-1-[0-9a-f]{16}$/);
    expect(await key({})).toBe(first);
    // A press after the last session was settled must not replay that session.
    expect(await key({ replaces: "cs_0" })).not.toBe(first);
    expect(await key({ firstChargeAt: null })).not.toBe(first);
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
        lines: TODAY,
        customerId: "c",
        successUrl: "https://x",
        cancelUrl: "https://x",
        firstChargeAt: null,
        now: NOW,
        replaces: null,
      }),
    ).toEqual({ status: "failed" });
  });
});

describe("the pricing test's Stripe side (ADR 20261022-pricing-ab-test)", () => {
  it("reads the percent plan's price and meter together, or not at all", () => {
    expect(
      percentBillingFromEnvironment({
        BILLING_STRIPE_PERCENT_PRICE_ID: "price_metered",
        BILLING_STRIPE_PERCENT_METER_EVENT: "diveday_fee_cents",
      }),
    ).toEqual(PERCENT);
    expect(
      percentBillingFromEnvironment({ BILLING_STRIPE_PERCENT_PRICE_ID: "price_m" }),
    ).toBeNull();
    expect(
      percentBillingFromEnvironment({
        BILLING_STRIPE_PERCENT_PRICE_ID: "prod_x",
        BILLING_STRIPE_PERCENT_METER_EVENT: "fee",
      }),
    ).toBeNull();
    expect(
      percentBillingFromEnvironment({
        BILLING_STRIPE_PERCENT_PRICE_ID: "price_m",
        BILLING_STRIPE_PERCENT_METER_EVENT: "fee&value=1",
      }),
    ).toBeNull();
  });

  it("sells today's flat price on the existing price, and any other fee as price_data", () => {
    expect(checkoutLines(termsFor("flat_monthly", DEFAULT_PRICING_CONFIG), CONFIG, null)).toEqual(
      TODAY,
    );
    expect(
      checkoutLines({ plan: "flat_monthly", monthlyCents: 12_900, basisPoints: 0 }, CONFIG, null),
    ).toEqual([{ kind: "monthly_amount", unitAmountCents: 12_900 }]);
  });

  it("sells the percent plan as its metered price, with a base fee line only above zero", () => {
    const percent = (monthlyCents: number) =>
      checkoutLines({ plan: "percent_of_volume", monthlyCents, basisPoints: 300 }, CONFIG, PERCENT);
    expect(percent(0)).toEqual([{ kind: "price", priceId: "price_metered", metered: true }]);
    expect(percent(2_900)).toEqual([
      { kind: "monthly_amount", unitAmountCents: 2_900 },
      { kind: "price", priceId: "price_metered", metered: true },
    ]);
    expect(
      checkoutLines({ plan: "percent_of_volume", monthlyCents: 0, basisPoints: 300 }, CONFIG, null),
    ).toBeNull();
  });

  it("builds price_data on the flat price's product, read once, and leaves a metered line unquantified", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) =>
      String(url).includes("/v1/prices/")
        ? new Response(JSON.stringify({ id: "price_monthly", product: "prod_diveday" }))
        : new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/c/1" })),
    );
    const provider = stripeBillingProvider(CONFIG, fetchMock as never);
    const request = {
      shopId: "shop-1",
      lines: [
        { kind: "monthly_amount", unitAmountCents: 2_900 },
        { kind: "price", priceId: "price_metered", metered: true },
      ] as CheckoutLine[],
      customerId: "cus_123",
      successUrl: "https://dive.day/ok",
      cancelUrl: "https://dive.day/back",
      firstChargeAt: null,
      now: NOW,
      replaces: null,
    };
    expect((await provider.createCheckoutSession(request)).status).toBe("ok");
    await provider.createCheckoutSession(request);
    const priceReads = fetchMock.mock.calls.filter(([url]) => String(url).includes("/v1/prices/"));
    expect(priceReads.length).toBeLessThanOrEqual(1);
    const checkout = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("checkout/sessions"),
    );
    const body = new URLSearchParams(String(checkout?.[1]?.body ?? ""));
    expect(body.get("line_items[0][price_data][product]")).toBe("prod_diveday");
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("2900");
    expect(body.get("line_items[0][price_data][currency]")).toBe("usd");
    expect(body.get("line_items[0][price_data][recurring][interval]")).toBe("month");
    expect(body.get("line_items[0][quantity]")).toBe("1");
    expect(body.get("line_items[1][price]")).toBe("price_metered");
    expect(body.has("line_items[1][quantity]")).toBe(false);
  });

  it("reports a month's fee to the meter, keyed by its identifier", async () => {
    const fetchMock = fakeFetch(200, { identifier: "diveday-fee-s-2026-09" });
    const provider = stripeBillingProvider(CONFIG, fetchMock as never);
    const at = new Date("2026-09-30T23:59:00.000Z");
    expect(
      await provider.reportMeterEvent({
        eventName: "diveday_fee_cents",
        customerId: "cus_123",
        valueCents: 3_015,
        identifier: "diveday-fee-s-2026-09",
        timestamp: at,
      }),
    ).toEqual({ status: "ok", value: "reported" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.stripe.com/v1/billing/meter_events",
    );
    const body = sentBody(fetchMock);
    expect(Object.fromEntries(body)).toEqual({
      event_name: "diveday_fee_cents",
      "payload[stripe_customer_id]": "cus_123",
      "payload[value]": "3015",
      identifier: "diveday-fee-s-2026-09",
      timestamp: String(Math.floor(at.getTime() / 1000)),
    });
    const headers = (fetchMock.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("diveday-fee-s-2026-09");
  });

  it("reads v2's duplicate_meter_event as already reported, and nothing else", async () => {
    // Stripe documents one duplicate-identifier code, `duplicate_meter_event`
    // (400) on its v2 meter-events API; v1 validates asynchronously and names
    // none, so `resource_already_exists` is not a meter-event answer at all.
    const event = {
      eventName: "e",
      customerId: "cus_1",
      valueCents: 1,
      identifier: "id",
      timestamp: NOW,
    };
    const dup = stripeBillingProvider(
      CONFIG,
      fakeFetch(400, { error: { code: "duplicate_meter_event" } }) as never,
    );
    expect(await dup.reportMeterEvent(event)).toEqual({ status: "ok", value: "already_reported" });
    const other = stripeBillingProvider(
      CONFIG,
      fakeFetch(400, { error: { code: "resource_already_exists" } }) as never,
    );
    expect(await other.reportMeterEvent(event)).toEqual({ status: "failed" });
  });

  it("reads what the meter holds for a customer over a window, from the metered price's meter", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.includes("/v1/prices/price_metered")) {
        return new Response(JSON.stringify({ product: "prod_x", recurring: { meter: "mtr_1" } }));
      }
      return new Response(
        JSON.stringify({ data: [{ aggregated_value: 1_000 }, { aggregated_value: 2_000 }] }),
      );
    });
    const provider = stripeBillingProvider(CONFIG, fetchMock as never);
    expect(
      await provider.meterValueReported({
        priceId: "price_metered",
        customerId: "cus_1",
        from: new Date("2031-06-01T00:00:00Z"),
        to: new Date("2031-07-01T00:00:00Z"),
      }),
    ).toEqual({ status: "ok", value: 3_000 });
    const summary = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(summary.pathname).toBe("/v1/billing/meters/mtr_1/event_summaries");
    expect(Object.fromEntries(summary.searchParams)).toEqual({
      customer: "cus_1",
      start_time: String(Date.parse("2031-06-01T00:00:00Z") / 1000),
      end_time: String(Date.parse("2031-07-01T00:00:00Z") / 1000),
    });
    const broken = stripeBillingProvider(CONFIG, fakeFetch(500, {}) as never);
    expect(
      await broken.meterValueReported({
        priceId: "price_metered_2",
        customerId: "cus_1",
        from: NOW,
        to: NOW,
      }),
    ).toEqual({ status: "failed" });
  });

  it("invoices a final month once: an item tagged with the identifier, then a sent invoice", async () => {
    const calls: { method: string; url: string; body: URLSearchParams; key?: string }[] = [];
    let items: unknown[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({
        method,
        url: String(url),
        body: new URLSearchParams(String(init?.body ?? "")),
        key: headers["Idempotency-Key"],
      });
      if (method === "GET") return new Response(JSON.stringify({ data: items }));
      if (String(url).endsWith("/v1/invoiceitems")) {
        items = [{ id: "ii_1", invoice: null, metadata: { diveday_statement: "fee-id" } }];
        return new Response(JSON.stringify({ id: "ii_1" }));
      }
      return new Response(JSON.stringify({ id: "in_1" }));
    });
    const provider = stripeBillingProvider(CONFIG, fetchMock as never);
    const input = {
      customerId: "cus_1",
      amountCents: 3_000,
      identifier: "fee-id",
      month: "2031-06",
    };
    expect(await provider.invoiceFinalMonth(input)).toEqual({ status: "ok", value: "invoiced" });
    const item = calls.find((call) => call.url.endsWith("/v1/invoiceitems"));
    expect(Object.fromEntries(item?.body ?? [])).toMatchObject({
      customer: "cus_1",
      amount: "3000",
      currency: "usd",
      "metadata[diveday_statement]": "fee-id",
    });
    expect(item?.key).toBe("fee-id-item");
    const invoice = calls.find((call) => call.url.endsWith("/v1/invoices"));
    expect(Object.fromEntries(invoice?.body ?? [])).toMatchObject({
      customer: "cus_1",
      collection_method: "send_invoice",
      pending_invoice_items_behavior: "include",
    });
    // The item already on an invoice: nothing more is sent.
    items = [{ id: "ii_1", invoice: "in_1", metadata: { diveday_statement: "fee-id" } }];
    calls.length = 0;
    expect(await provider.invoiceFinalMonth(input)).toEqual({
      status: "ok",
      value: "already_invoiced",
    });
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);
  });

  it("reads Stripe already holding the identifier as reported, and anything else as failed", async () => {
    const event = {
      eventName: "e",
      customerId: "cus_1",
      valueCents: 1,
      identifier: "id",
      timestamp: NOW,
    };
    const dup = stripeBillingProvider(
      CONFIG,
      fakeFetch(400, { error: { code: "duplicate_meter_event" } }) as never,
    );
    expect(await dup.reportMeterEvent(event)).toEqual({ status: "ok", value: "already_reported" });
    const bad = stripeBillingProvider(CONFIG, fakeFetch(400, { error: { code: "x" } }) as never);
    expect(await bad.reportMeterEvent(event)).toEqual({ status: "failed" });
    const neg = stripeBillingProvider(CONFIG, fakeFetch(200, {}) as never);
    expect(await neg.reportMeterEvent({ ...event, valueCents: -1 })).toEqual({ status: "failed" });
  });
});
