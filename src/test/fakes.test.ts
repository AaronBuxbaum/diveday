import { describe, expect, it } from "vitest";
import type { CheckoutProvider, CreateCheckoutSessionRequest } from "../lib/payments/checkout";
import { recordingCheckout } from "./fakes";

function request(idempotencyKey: string): CreateCheckoutSessionRequest {
  return {
    stripeAccountId: "acct_test",
    currency: "usd",
    lineItems: [{ description: "Dive", unitAmountCents: 1400, quantity: 3 }],
    customerEmail: "diver@example.com",
    successUrl: "https://diveday.example/return",
    cancelUrl: "https://diveday.example/cancel",
    idempotencyKey,
  };
}

describe("recordingCheckout", () => {
  it("records requests and keeps the base fake's sequential session ids", async () => {
    const firstRequest = request("first");
    const secondRequest = request("second");
    const { requests, provider } = recordingCheckout();

    const first = await provider.createCheckoutSession(firstRequest);
    const second = await provider.createCheckoutSession(secondRequest);

    expect(requests).toEqual([firstRequest, secondRequest]);
    expect(first).toMatchObject({
      status: "created",
      stripeSessionId: "cs_1",
      amountTotalCents: 4200,
    });
    expect(second).toMatchObject({
      status: "created",
      stripeSessionId: "cs_2",
      amountTotalCents: 4200,
    });
  });

  it("records then delegates to create, retrieve and refund overrides", async () => {
    const createCalls: CreateCheckoutSessionRequest[] = [];
    const retrieveCalls: [string, string][] = [];
    const refundCalls: [string, string, string, number | undefined][] = [];
    const createResult = { status: "failed" } as const;
    const overrides: Partial<CheckoutProvider> = {
      async createCheckoutSession(input) {
        createCalls.push(input);
        return createResult;
      },
      async retrieveCheckoutSession(accountId, sessionId) {
        retrieveCalls.push([accountId, sessionId]);
        return { status: "not_configured" };
      },
      async refundCheckoutSession(accountId, sessionId, key, amountCents) {
        refundCalls.push([accountId, sessionId, key, amountCents]);
        return { status: "not_configured" };
      },
    };
    const { requests, provider } = recordingCheckout(overrides);
    const input = request("custom");

    expect(await provider.createCheckoutSession(input)).toBe(createResult);
    expect(await provider.retrieveCheckoutSession("acct_test", "cs_custom")).toEqual({
      status: "not_configured",
    });
    expect(
      await provider.refundCheckoutSession("acct_test", "cs_custom", "refund-key", 500),
    ).toEqual({ status: "not_configured" });

    expect(requests).toEqual([input]);
    expect(createCalls).toEqual([input]);
    expect(retrieveCalls).toEqual([["acct_test", "cs_custom"]]);
    expect(refundCalls).toEqual([["acct_test", "cs_custom", "refund-key", 500]]);
  });
});
