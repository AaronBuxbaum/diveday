import { describe, expect, it, vi } from "vitest";
import { invoicingProviderFromEnvironment } from "./invoicing";

function providerWith(env: Record<string, string | undefined>, fetchImpl: unknown) {
  return invoicingProviderFromEnvironment(env, fetchImpl as typeof fetch);
}

const request = {
  stripeAccountId: "acct_123",
  customerEmail: "diver@example.com",
  customerName: "Dana Diver",
  currency: "usd",
  lineItems: [
    { description: "Two-tank charter", quantity: 1, unitAmountCents: 18_000 },
    { description: "Rental gear", quantity: 1, unitAmountCents: 4_000 },
  ],
  idempotencyKey: "intent-1",
};

function sequencedFetch(responses: unknown[]) {
  const fn = vi.fn();
  for (const response of responses) fn.mockResolvedValueOnce(response);
  return fn;
}

function ok(json: unknown) {
  return { ok: true, json: async () => json };
}

describe("stripe invoicing provider", () => {
  it("is not_configured without a Stripe key", async () => {
    const provider = providerWith({}, vi.fn());
    expect(await provider.createInvoice(request)).toEqual({ status: "not_configured" });
    expect(await provider.voidInvoice("acct_123", "in_1")).toEqual({ status: "not_configured" });
    expect(await provider.refundInvoice("acct_123", "in_1", "intent-1")).toEqual({
      status: "not_configured",
    });
    expect(await provider.retrieveInvoice("acct_123", "in_1")).toEqual({
      status: "not_configured",
    });
  });

  it("returns the created invoice's hosted URL, PDF, and total", async () => {
    const fetchImpl = sequencedFetch([
      ok({ id: "cus_1" }),
      ok({ id: "ii_1" }),
      ok({ id: "ii_2" }),
      ok({ id: "in_1", status: "draft", total: 22_000 }),
      ok({
        id: "in_1",
        status: "open",
        hosted_invoice_url: "https://invoice.stripe.com/i/acct_123/in_1",
        invoice_pdf: "https://invoice.stripe.com/i/acct_123/in_1/pdf",
        total: 22_000,
      }),
      ok({ id: "in_1", status: "open", total: 22_000 }),
    ]);
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    const result = await provider.createInvoice(request);
    expect(result).toEqual({
      status: "created",
      stripeCustomerId: "cus_1",
      stripeInvoiceId: "in_1",
      stripeStatus: "open",
      hostedInvoiceUrl: "https://invoice.stripe.com/i/acct_123/in_1",
      invoicePdfUrl: "https://invoice.stripe.com/i/acct_123/in_1/pdf",
      totalCents: 22_000,
    });

    // Every call to Stripe carried the connected account header, not the platform.
    for (const call of fetchImpl.mock.calls) {
      expect(call[1].headers["Stripe-Account"]).toBe("acct_123");
    }
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.stripe.com/v1/customers");
    expect(fetchImpl.mock.calls[1][0]).toBe("https://api.stripe.com/v1/invoiceitems");
    expect(fetchImpl.mock.calls[3][0]).toBe("https://api.stripe.com/v1/invoices");
    expect(fetchImpl.mock.calls[4][0]).toBe("https://api.stripe.com/v1/invoices/in_1/finalize");
    expect(fetchImpl.mock.calls[5][0]).toBe("https://api.stripe.com/v1/invoices/in_1/send");

    // Each step of the chain gets its own deterministic, step-scoped key
    // derived from the request's idempotencyKey — a retry of this same
    // attempt replays each step against the object it created the first
    // time, never a second customer/item/invoice (CR-005).
    expect(fetchImpl.mock.calls[0][1].headers["Idempotency-Key"]).toBe("intent-1:customer");
    expect(fetchImpl.mock.calls[1][1].headers["Idempotency-Key"]).toBe("intent-1:item:0");
    expect(fetchImpl.mock.calls[2][1].headers["Idempotency-Key"]).toBe("intent-1:item:1");
    expect(fetchImpl.mock.calls[3][1].headers["Idempotency-Key"]).toBe("intent-1:invoice");
    expect(fetchImpl.mock.calls[4][1].headers["Idempotency-Key"]).toBe("intent-1:finalize");
    expect(fetchImpl.mock.calls[5][1].headers["Idempotency-Key"]).toBe("intent-1:send");
  });

  it("fails if any step in the chain is not ok", async () => {
    const fetchImpl = sequencedFetch([ok({ id: "cus_1" }), { ok: false, json: async () => ({}) }]);
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    expect(await provider.createInvoice(request)).toEqual({ status: "failed" });
  });

  it("fails on a network error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network"));
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    expect(await provider.createInvoice(request)).toEqual({ status: "failed" });
  });

  it("voids an invoice on the connected account", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ id: "in_1", status: "void" }));
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    expect(await provider.voidInvoice("acct_123", "in_1")).toEqual({ status: "voided" });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.stripe.com/v1/invoices/in_1/void");
  });

  it("refunds a paid invoice's payment intent on the connected account", async () => {
    const fetchImpl = sequencedFetch([
      ok({ id: "in_1", status: "paid", total: 22_000, payment_intent: "pi_1" }),
      ok({ id: "re_1" }),
    ]);
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    expect(await provider.refundInvoice("acct_123", "in_1", "intent-2")).toEqual({
      status: "refunded",
      refundId: "re_1",
    });
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://api.stripe.com/v1/invoices/in_1?expand[]=payment_intent",
    );
    expect(fetchImpl.mock.calls[1][0]).toBe("https://api.stripe.com/v1/refunds");
    expect(fetchImpl.mock.calls[1][1].body).toContain("payment_intent=pi_1");
    expect(fetchImpl.mock.calls[1][1].headers["Idempotency-Key"]).toBe("intent-2");
  });

  it("retrieves current invoice status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok({
        id: "in_1",
        status: "paid",
        hosted_invoice_url: "https://invoice.stripe.com/i/acct_123/in_1",
        invoice_pdf: null,
        total: 22_000,
        amount_paid: 22_000,
      }),
    );
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    const result = await provider.retrieveInvoice("acct_123", "in_1");
    expect(result).toEqual({
      status: "ok",
      invoice: {
        status: "paid",
        hostedInvoiceUrl: "https://invoice.stripe.com/i/acct_123/in_1",
        invoicePdfUrl: null,
        amountPaidCents: 22_000,
        totalCents: 22_000,
      },
    });
  });
});
