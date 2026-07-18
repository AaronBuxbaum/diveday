import { describe, expect, it, vi } from "vitest";
import { createCheckout, paymentProviderFromEnvironment } from "./index";

const request = {
  amountCents: 18_000,
  currency: "usd",
  description: "Wreck charter",
  bookingId: "booking-1",
  successUrl: "https://shop.example/ok",
  cancelUrl: "https://shop.example/cancel",
};

function providerWith(env: Record<string, string | undefined>, fetchImpl: unknown) {
  return paymentProviderFromEnvironment(env, fetchImpl as typeof fetch);
}

describe("payment checkout seam", () => {
  it("is not_configured without a Stripe key", async () => {
    expect(await createCheckout(request, providerWith({}, vi.fn()))).toEqual({
      status: "not_configured",
    });
  });

  it("creates a Stripe checkout session and returns its URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://checkout.stripe.com/c/pay/abc" }),
    });
    const result = await createCheckout(
      request,
      providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl),
    );
    expect(result).toEqual({ status: "created", url: "https://checkout.stripe.com/c/pay/abc" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(init.headers.Authorization).toBe("Bearer sk_test");
    expect(init.body).toContain("client_reference_id=booking-1");
    expect(init.body).toContain("unit_amount%5D=18000");
  });

  it("fails on a non-ok response or network error", async () => {
    const notOk = providerWith(
      { STRIPE_SECRET_KEY: "sk_test" },
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
    );
    expect(await createCheckout(request, notOk)).toEqual({ status: "failed" });

    const threw = providerWith(
      { STRIPE_SECRET_KEY: "sk_test" },
      vi.fn().mockRejectedValue(new Error("network")),
    );
    expect(await createCheckout(request, threw)).toEqual({ status: "failed" });
  });
});
