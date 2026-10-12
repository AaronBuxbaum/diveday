import { describe, expect, it, vi } from "vitest";
import { paymentSourceLookupFor, stripePaymentSourceLookup } from "./payment-sources";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("stripePaymentSourceLookup", () => {
  it("finds the invoice a PaymentIntent paid, on the connected account, read-only", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ invoice: "in_1", payment: { payment_intent: "pi_1" } }] }),
    );
    const lookup = stripePaymentSourceLookup({ secretKey: "sk_test" }, fetchImpl as never);
    expect(await lookup.findSource("acct_1", "pi_1")).toEqual({
      status: "invoice",
      stripeInvoiceId: "in_1",
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://api.stripe.com/v1/invoice_payments?payment%5Btype%5D=payment_intent&payment%5Bpayment_intent%5D=pi_1&limit=1",
    );
    expect(init.method).toBeUndefined();
    expect(init.headers).toMatchObject({ "Stripe-Account": "acct_1" });
  });

  it("falls through to Checkout sessions when no invoice was paid by it", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "cs_1" }] }));
    const lookup = stripePaymentSourceLookup({ secretKey: "sk_test" }, fetchImpl);
    expect(await lookup.findSource("acct_1", "pi_1")).toEqual({
      status: "checkout_session",
      stripeSessionId: "cs_1",
    });
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      "https://api.stripe.com/v1/checkout/sessions?payment_intent=pi_1&limit=1",
    );
  });

  it("answers none when Stripe knows the charge but DiveDay raised neither", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [] }));
    const lookup = stripePaymentSourceLookup({ secretKey: "sk_test" }, fetchImpl as never);
    expect(await lookup.findSource("acct_1", "pi_till")).toEqual({ status: "none" });
  });

  it("tells a refusal or an unreachable Stripe apart from none, so the event is retried", async () => {
    const refused = stripePaymentSourceLookup({ secretKey: "sk_test" }, (async () =>
      jsonResponse({ error: {} }, 500)) as never);
    expect(await refused.findSource("acct_1", "pi_1")).toEqual({ status: "failed" });
    const thrown = stripePaymentSourceLookup({ secretKey: "sk_test" }, (async () => {
      throw new TypeError("network");
    }) as never);
    expect(await thrown.findSource("acct_1", "pi_1")).toEqual({ status: "failed" });
  });

  it("answers none for a permanent Stripe refusal, and retries only what may pass next time", async () => {
    for (const status of [400, 401, 403, 404]) {
      const refused = stripePaymentSourceLookup({ secretKey: "sk_test" }, (async () =>
        jsonResponse({ error: {} }, status)) as never);
      expect(await refused.findSource("acct_1", "pi_1")).toEqual({ status: "none" });
    }
    for (const status of [429, 500, 503]) {
      const busy = stripePaymentSourceLookup({ secretKey: "sk_test" }, (async () =>
        jsonResponse({ error: {} }, status)) as never);
      expect(await busy.findSource("acct_1", "pi_1")).toEqual({ status: "failed" });
    }
  });

  it("never asks Stripe about an event from the other mode than its key", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [] }));
    const live = { secretKey: "sk_live_x" };
    expect(
      await paymentSourceLookupFor(live, fetchImpl as never, { livemode: false }).findSource(
        "acct_1",
        "pi_1",
      ),
    ).toEqual({ status: "not_configured" });
    const test = { secretKey: "rk_test_x" };
    expect(
      await paymentSourceLookupFor(test, fetchImpl as never, { livemode: true }).findSource(
        "acct_1",
        "pi_1",
      ),
    ).toEqual({ status: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
    await paymentSourceLookupFor(live, fetchImpl as never, { livemode: true }).findSource(
      "acct_1",
      "pi_1",
    );
    expect(fetchImpl).toHaveBeenCalled();
  });

  // Issue #2296: the demo's account is asked with its own test-mode key, on a
  // deployment whose platform key is live, so a refund made in the demo's test
  // dashboard still finds its checkout.
  it("asks with the key chosen for the event's account", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [] }));
    const keys = {
      secretKeyFor: (account: string) =>
        account === "acct_demo" ? "sk_test_demo" : account === "acct_real" ? "sk_live_x" : null,
    };
    const testEvent = paymentSourceLookupFor(keys, fetchImpl as never, { livemode: false });

    await testEvent.findSource("acct_demo", "pi_1");
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({
      Authorization: "Bearer sk_test_demo",
      "Stripe-Account": "acct_demo",
    });

    fetchImpl.mockClear();
    // A real shop's live key never answers a test event; an account with no key is not asked.
    expect(await testEvent.findSource("acct_real", "pi_1")).toEqual({ status: "not_configured" });
    expect(await testEvent.findSource("acct_other", "pi_1")).toEqual({
      status: "not_configured",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is not_configured without a key source", async () => {
    expect(await paymentSourceLookupFor(null).findSource("acct_1", "pi_1")).toEqual({
      status: "not_configured",
    });
  });
});
