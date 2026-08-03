import { describe, expect, it, vi } from "vitest";
import { customerProviderFromEnvironment } from "./customers";

function providerWith(env: Record<string, string | undefined>, fetchImpl: unknown) {
  return customerProviderFromEnvironment(env, fetchImpl as typeof fetch);
}

const CONFIGURED = { STRIPE_SECRET_KEY: "sk_test_123" };

describe("stripe customer provider", () => {
  it("is not_configured without a Stripe key", async () => {
    const fetchImpl = vi.fn();
    const provider = providerWith({}, fetchImpl);
    expect(await provider.deleteCustomer("acct_1", "cus_1", "key")).toEqual({
      status: "not_configured",
    });
    // And it never reaches out — a deployment with no key must not be making
    // half-authenticated calls at Stripe.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("deletes on the connected account, with the idempotency key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "cus_1", deleted: true }),
    });
    const provider = providerWith(CONFIGURED, fetchImpl);

    expect(
      await provider.deleteCustomer("acct_1", "cus_1", "obligation-1:customer-delete"),
    ).toEqual({ status: "deleted" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.stripe.com/v1/customers/cus_1",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          Authorization: "Bearer sk_test_123",
          // The delete must land in the *shop's* account, never the platform's.
          "Stripe-Account": "acct_1",
          "Idempotency-Key": "obligation-1:customer-delete",
        }),
      }),
    );
  });

  it("treats a 404 as already deleted rather than a failure to retry forever", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    const provider = providerWith(CONFIGURED, fetchImpl);
    expect(await provider.deleteCustomer("acct_1", "cus_gone", "key")).toEqual({
      status: "already_deleted",
    });
  });

  it("reports a Stripe error with its code, bounded in length", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: "account_invalid", message: "x".repeat(500) } }),
    });
    const provider = providerWith(CONFIGURED, fetchImpl);
    const result = await provider.deleteCustomer("acct_1", "cus_1", "key");
    expect(result).toEqual({ status: "failed", error: "HTTP 401: account_invalid" });
  });

  it("survives a non-JSON error body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
    });
    const provider = providerWith(CONFIGURED, fetchImpl);
    expect(await provider.deleteCustomer("acct_1", "cus_1", "key")).toEqual({
      status: "failed",
      error: "HTTP 502",
    });
  });

  it("refuses to call it deleted when Stripe says it is not", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "cus_1", deleted: false }),
    });
    const provider = providerWith(CONFIGURED, fetchImpl);
    expect(await provider.deleteCustomer("acct_1", "cus_1", "key")).toMatchObject({
      status: "failed",
    });
  });

  it("turns a network throw into a failure, never an exception at the caller", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const provider = providerWith(CONFIGURED, fetchImpl);
    expect(await provider.deleteCustomer("acct_1", "cus_1", "key")).toEqual({
      status: "failed",
      error: "ECONNRESET",
    });
  });
});
