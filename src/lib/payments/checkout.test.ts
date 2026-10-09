import { describe, expect, it, vi } from "vitest";
import { checkoutProviderFromEnvironment } from "./checkout";

/** The `stripe_api.request_threw` lines a case wrote, parsed. */
function threwLines(spy: { mock: { calls: unknown[][] } }): Array<Record<string, unknown>> {
  return spy.mock.calls
    .map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
    .filter((line) => line.event === "stripe_api.request_threw");
}

function providerWith(env: Record<string, string | undefined>, fetchImpl: unknown) {
  return checkoutProviderFromEnvironment(env, fetchImpl as typeof fetch);
}

const request = {
  stripeAccountId: "acct_123",
  currency: "usd",
  lineItems: [{ description: "Two-tank charter", unitAmountCents: 18_000, quantity: 2 }],
  customerEmail: "diver@example.com",
  successUrl: "https://diveday.example/shop/reef/schedule/t1?booking=b1",
  cancelUrl: "https://diveday.example/shop/reef/schedule/t1?booking=b1&pay=cancelled",
  idempotencyKey: "intent-1",
};

function ok(json: unknown) {
  return { ok: true, json: async () => json };
}

describe("stripe checkout provider", () => {
  it("is not_configured without a Stripe key", async () => {
    const provider = providerWith({}, vi.fn());
    expect(await provider.createCheckoutSession(request)).toEqual({ status: "not_configured" });
    expect(await provider.retrieveCheckoutSession("acct_123", "cs_1")).toEqual({
      status: "not_configured",
    });
  });

  it("creates a hosted session on the connected account with one priced line", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok({
        id: "cs_1",
        status: "open",
        payment_status: "unpaid",
        url: "https://checkout.stripe.com/c/pay/cs_1",
        amount_total: 36_000,
        expires_at: 1_790_000_000,
      }),
    );
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    const result = await provider.createCheckoutSession(request);
    expect(result).toEqual({
      status: "created",
      stripeSessionId: "cs_1",
      stripeStatus: "open",
      paymentStatus: "unpaid",
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_1",
      amountTotalCents: 36_000,
      taxAmountCents: null,
      // Stripe sent no `customer` on a session it has only just opened.
      stripeCustomerId: null,
      expiresAt: new Date(1_790_000_000 * 1000),
    });

    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.stripe.com/v1/checkout/sessions");
    const call = fetchImpl.mock.calls[0][1];
    expect(call.headers["Stripe-Account"]).toBe("acct_123");
    expect(call.headers["Idempotency-Key"]).toBe("intent-1");
    const form = new URLSearchParams(call.body);
    expect(form.get("mode")).toBe("payment");
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("18000");
    expect(form.get("line_items[0][quantity]")).toBe("2");
    expect(form.get("customer_email")).toBe("diver@example.com");
    expect(form.get("success_url")).toBe(request.successUrl);
    expect(form.get("cancel_url")).toBe(request.cancelUrl);
  });

  it("enables exclusive automatic tax on every Checkout line when requested", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok({
        id: "cs_taxed",
        status: "open",
        payment_status: "unpaid",
        url: "https://checkout.stripe.com/c/pay/cs_taxed",
        amount_total: 42_000,
        total_details: { amount_tax: 2_000 },
        expires_at: 1_790_000_000,
      }),
    );
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    const result = await provider.createCheckoutSession({
      ...request,
      lineItems: [
        ...request.lineItems,
        { description: "Rental gear", unitAmountCents: 4_000, quantity: 1 },
      ],
      taxEnabled: true,
    });

    expect(result).toMatchObject({ status: "created", taxAmountCents: 2_000 });
    const form = new URLSearchParams(fetchImpl.mock.calls[0][1].body);
    expect(form.get("automatic_tax[enabled]")).toBe("true");
    expect(form.get("billing_address_collection")).toBe("required");
    expect(form.get("line_items[0][price_data][tax_behavior]")).toBe("exclusive");
    expect(form.get("line_items[1][price_data][tax_behavior]")).toBe("exclusive");
  });

  it("creates one Stripe line item per entry in lineItems", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok({
        id: "cs_2",
        status: "open",
        payment_status: "unpaid",
        url: "https://checkout.stripe.com/c/pay/cs_2",
        amount_total: 42_000,
        expires_at: 1_790_000_000,
      }),
    );
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    await provider.createCheckoutSession({
      ...request,
      lineItems: [
        { description: "Two-tank charter", unitAmountCents: 18_000, quantity: 2 },
        { description: "Rental gear — Dana", unitAmountCents: 6_000, quantity: 1 },
      ],
    });
    const form = new URLSearchParams(fetchImpl.mock.calls[0][1].body);
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("18000");
    expect(form.get("line_items[0][quantity]")).toBe("2");
    expect(form.get("line_items[0][price_data][product_data][name]")).toBe("Two-tank charter");
    expect(form.get("line_items[1][price_data][unit_amount]")).toBe("6000");
    expect(form.get("line_items[1][quantity]")).toBe("1");
    expect(form.get("line_items[1][price_data][product_data][name]")).toBe("Rental gear — Dana");
  });

  it("fails without calling Stripe when lineItems is empty", async () => {
    const fetchImpl = vi.fn();
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    expect(await provider.createCheckoutSession({ ...request, lineItems: [] })).toEqual({
      status: "failed",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("applies a promotion code as a Checkout discount when one is validated", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok({
        id: "cs_1",
        status: "open",
        payment_status: "unpaid",
        url: "https://checkout.stripe.com/c/pay/cs_1",
        amount_total: 18_000,
        expires_at: 1_790_000_000,
      }),
    );
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    await provider.createCheckoutSession({ ...request, promotionCode: "promo_123" });
    const form = new URLSearchParams(fetchImpl.mock.calls[0][1].body);
    expect(form.get("discounts[0][promotion_code]")).toBe("promo_123");
  });

  it("omits the discounts param when no promotion code is given", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok({
        id: "cs_1",
        status: "open",
        payment_status: "unpaid",
        url: "https://checkout.stripe.com/c/pay/cs_1",
        amount_total: 18_000,
        expires_at: 1_790_000_000,
      }),
    );
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    await provider.createCheckoutSession(request);
    const form = new URLSearchParams(fetchImpl.mock.calls[0][1].body);
    expect(form.has("discounts[0][promotion_code]")).toBe(false);
  });

  it("fails when Stripe rejects the create", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    expect(await provider.createCheckoutSession(request)).toEqual({ status: "failed" });
  });

  it("fails on a network error, and logs the throw so it reads apart from a refusal", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("network"));
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    expect(await provider.createCheckoutSession(request)).toEqual({ status: "failed" });
    expect(await provider.retrieveCheckoutSession("acct_123", "cs_1")).toEqual({
      status: "failed",
    });
    expect(threwLines(warned)).toEqual([
      expect.objectContaining({ operation: "create_checkout_session", errorCode: "TypeError" }),
      expect.objectContaining({ operation: "retrieve_checkout_session", errorCode: "TypeError" }),
    ]);
    warned.mockRestore();
  });

  it("retrieves current session status from Stripe, not from any URL claim", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok({
        id: "cs_1",
        status: "complete",
        payment_status: "paid",
        url: null,
        amount_total: 36_000,
      }),
    );
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    const result = await provider.retrieveCheckoutSession("acct_123", "cs_1");
    expect(result).toEqual({
      status: "ok",
      session: {
        stripeSessionId: "cs_1",
        stripeStatus: "complete",
        paymentStatus: "paid",
        checkoutUrl: null,
        amountTotalCents: 36_000,
        taxAmountCents: null,
        stripeCustomerId: null,
        expiresAt: null,
      },
    });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.stripe.com/v1/checkout/sessions/cs_1");
    expect(fetchImpl.mock.calls[0][1].headers["Stripe-Account"]).toBe("acct_123");
  });

  it("reads the Customer id whether Stripe sends it bare or expanded", async () => {
    // `paymentIntentIdOf`'s twin: a `?expand[]=customer` read returns the whole
    // Customer object where an ordinary read returns the id, and erasure needs
    // the id either way (issue #1621).
    const bare = providerWith(
      { STRIPE_SECRET_KEY: "sk_test" },
      vi.fn().mockResolvedValue(
        ok({
          id: "cs_1",
          status: "complete",
          payment_status: "paid",
          amount_total: 36_000,
          customer: "cus_bare",
        }),
      ),
    );
    const bareResult = await bare.retrieveCheckoutSession("acct_123", "cs_1");
    expect(bareResult).toMatchObject({ session: { stripeCustomerId: "cus_bare" } });

    const expanded = providerWith(
      { STRIPE_SECRET_KEY: "sk_test" },
      vi.fn().mockResolvedValue(
        ok({
          id: "cs_1",
          status: "complete",
          payment_status: "paid",
          amount_total: 36_000,
          customer: { id: "cus_expanded", object: "customer" },
        }),
      ),
    );
    const expandedResult = await expanded.retrieveCheckoutSession("acct_123", "cs_1");
    expect(expandedResult).toMatchObject({ session: { stripeCustomerId: "cus_expanded" } });
  });

  it("reports a missing amount_total as no settled figure, never as zero money", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok({
        id: "cs_1",
        status: "complete",
        payment_status: "paid",
        url: null,
        amount_total: null,
      }),
    );
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    const result = await provider.retrieveCheckoutSession("acct_123", "cs_1");
    expect(result.status === "ok" && result.session.amountTotalCents).toBeNull();
  });

  it("is not_configured to refund without a Stripe key", async () => {
    const provider = providerWith({}, vi.fn());
    expect(await provider.refundCheckoutSession("acct_123", "cs_1", "intent-9", 5_000)).toEqual({
      status: "not_configured",
    });
  });

  it("reverses the session's payment intent with an amount and an idempotency key", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        ok({
          id: "cs_1",
          status: "complete",
          payment_status: "paid",
          amount_total: 18_000,
          payment_intent: "pi_9",
        }),
      )
      .mockResolvedValueOnce(ok({ id: "re_1" }));
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    const result = await provider.refundCheckoutSession("acct_123", "cs_1", "intent-9", 5_000);
    expect(result).toEqual({ status: "refunded", refundId: "re_1" });

    const [sessionUrl] = fetchImpl.mock.calls[0];
    expect(sessionUrl).toBe(
      "https://api.stripe.com/v1/checkout/sessions/cs_1?expand[]=payment_intent",
    );
    const [refundUrl, refundInit] = fetchImpl.mock.calls[1];
    expect(refundUrl).toBe("https://api.stripe.com/v1/refunds");
    expect(refundInit.headers["Idempotency-Key"]).toBe("intent-9");
    const form = new URLSearchParams(refundInit.body);
    expect(form.get("payment_intent")).toBe("pi_9");
    expect(form.get("amount")).toBe("5000");
  });

  it("passes the caller's key through for a full refund and omits the amount", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        ok({
          id: "cs_1",
          status: "complete",
          payment_status: "paid",
          amount_total: 18_000,
          payment_intent: { id: "pi_full" },
        }),
      )
      .mockResolvedValueOnce(ok({ id: "re_2" }));
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    await provider.refundCheckoutSession("acct_123", "cs_1", "intent-10");
    const refundInit = fetchImpl.mock.calls[1][1];
    expect(refundInit.headers["Idempotency-Key"]).toBe("intent-10");
    expect(new URLSearchParams(refundInit.body).get("amount")).toBeNull();
  });

  it("is not_refundable when the session captured no payment intent", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      ok({
        id: "cs_1",
        status: "complete",
        payment_status: "unpaid",
        amount_total: 0,
        payment_intent: null,
      }),
    );
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    expect(await provider.refundCheckoutSession("acct_123", "cs_1", "intent-11")).toEqual({
      status: "not_refundable",
    });
    // Never posted a refund.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails when Stripe rejects the refund", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        ok({
          id: "cs_1",
          status: "complete",
          payment_status: "paid",
          amount_total: 18_000,
          payment_intent: "pi_9",
        }),
      )
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    expect(await provider.refundCheckoutSession("acct_123", "cs_1", "intent-12")).toEqual({
      status: "failed",
    });
  });
});

/**
 * The demo shop's checkout is the same flow on Stripe's test mode (ADR
 * 20261009-demo-test-mode-payments): the key follows the connected account.
 */
describe("the demo's test-mode account", () => {
  const env = {
    STRIPE_SECRET_KEY: "sk_live_platformKey123",
    STRIPE_DEMO_ACCOUNT_ID: "acct_demoTestMode1",
    STRIPE_DEMO_SECRET_KEY: "sk_test_demoKey12345",
  };
  const session = ok({
    id: "cs_test_1",
    status: "open",
    payment_status: "unpaid",
    amount_total: 1,
  });

  it("is called with the test-mode key, and every other account with the platform key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(session);
    const provider = providerWith(env, fetchImpl);
    await provider.createCheckoutSession({ ...request, stripeAccountId: "acct_demoTestMode1" });
    await provider.createCheckoutSession({ ...request, stripeAccountId: "acct_realShop123" });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer sk_test_demoKey12345");
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe("Bearer sk_live_platformKey123");
  });

  it("is never called at all when its test key is missing or is not a test key", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const demoKey of ["", "sk_live_pastedInTheWrongPlace"]) {
      const fetchImpl = vi.fn().mockResolvedValue(session);
      const provider = providerWith({ ...env, STRIPE_DEMO_SECRET_KEY: demoKey }, fetchImpl);
      const result = await provider.createCheckoutSession({
        ...request,
        stripeAccountId: "acct_demoTestMode1",
      });
      expect(result).toEqual({ status: "failed" });
      expect(fetchImpl).not.toHaveBeenCalled();
    }
    vi.restoreAllMocks();
  });
});
