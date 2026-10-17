import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { checkoutProviderFromEnvironment } from "@/db/stripe-providers";
import { boundedStripeFetch, STRIPE_REQUEST_TIMEOUT_MS } from "./stripe-fetch";

/** A fetch that answers only when its signal aborts, as a hung Stripe would. */
function hungFetch() {
  return vi.fn(
    (_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  );
}

describe("boundedStripeFetch", () => {
  it("gives up on a request that never answers", async () => {
    const fetchImpl = hungFetch();
    const bounded = boundedStripeFetch(fetchImpl as unknown as typeof fetch, 20);
    await expect(bounded("https://api.stripe.com/v1/x")).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("keeps a signal the caller already chose", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}"));
    const own = new AbortController().signal;
    await boundedStripeFetch(fetchImpl)("https://api.stripe.com/v1/x", { signal: own });
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBe(own);
  });

  it("is ten seconds by default", () => {
    expect(STRIPE_REQUEST_TIMEOUT_MS).toBe(10_000);
  });
});

describe("the checkout adapter, the call a tip makes under a booking lock", () => {
  const request = {
    stripeAccountId: "acct_123",
    currency: "usd",
    lineItems: [{ description: "Tip", unitAmountCents: 1_000, quantity: 1 }],
    customerEmail: "diver@example.com",
    successUrl: "https://diveday.example/ok",
    cancelUrl: "https://diveday.example/cancel",
    idempotencyKey: "intent-1",
  };

  it("hands Stripe a live deadline", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 500 }));
    const provider = checkoutProviderFromEnvironment(
      { STRIPE_SECRET_KEY: "sk_test_x" },
      fetchImpl as unknown as typeof fetch,
    );
    await provider.createCheckoutSession(request);
    const signal = fetchImpl.mock.calls[0]?.[1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  it("ends a timed-out session request as failed: no money moves without the diver", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new DOMException("The operation was aborted", "TimeoutError"));
    const provider = checkoutProviderFromEnvironment(
      { STRIPE_SECRET_KEY: "sk_test_x" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(await provider.createCheckoutSession(request)).toEqual({ status: "failed" });
  });
});

describe("a refund Stripe never answers", () => {
  const timedOut = () => new DOMException("The operation was aborted", "TimeoutError");
  const session = {
    id: "cs_1",
    status: "complete",
    payment_status: "paid",
    amount_total: 1_000,
    payment_intent: "pi_1",
  };

  it("is unanswered, never failed, once the refund itself went out", async () => {
    // A `failed` here let the caller resolve the intent and the next press
    // mint a fresh idempotency key: a second real reversal (fifth review).
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(session)))
      .mockRejectedValueOnce(timedOut());
    const provider = checkoutProviderFromEnvironment(
      { STRIPE_SECRET_KEY: "sk_test_x" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(await provider.refundCheckoutSession("acct_123", "cs_1", "intent-1")).toEqual({
      status: "unanswered",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("is failed while only the lookup timed out, since nothing was asked of Stripe", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(timedOut());
    const provider = checkoutProviderFromEnvironment(
      { STRIPE_SECRET_KEY: "sk_test_x" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(await provider.refundCheckoutSession("acct_123", "cs_1", "intent-1")).toEqual({
      status: "failed",
    });
  });
});

/**
 * The source files under `src` that name a Stripe host and make any fetch
 * call: whatever the fetch is called, so a renamed parameter cannot hide one.
 */
function stripeCallers(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) found.push(...stripeCallers(full));
    // The wrapper itself names the host in its docs and calls the fetch it wraps.
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== "stripe-fetch.ts") {
      const source = readFileSync(full, "utf8");
      if (/stripe\.com/.test(source) && /\b\w*[fF]etch\w*\s*\(/.test(source)) {
        found.push(path.relative(process.cwd(), full));
      }
    }
  }
  return found.sort();
}

describe("every Stripe adapter", () => {
  it("is one of the eight known callers, each wrapping its fetch in boundedStripeFetch", () => {
    // Pinned, not counted: a ninth file that reaches Stripe fails here until
    // it is added to this list, and it can only be added wrapped.
    expect(stripeCallers(path.join(process.cwd(), "src"))).toEqual([
      "src/lib/billing/stripe-billing.ts",
      "src/lib/payments/checkout.ts",
      "src/lib/payments/connect.ts",
      "src/lib/payments/customers.ts",
      "src/lib/payments/invoicing.ts",
      "src/lib/payments/payment-sources.ts",
      "src/lib/payments/payout-summary.ts",
      "src/lib/payments/promotions.ts",
    ]);
    const unbounded = stripeCallers(path.join(process.cwd(), "src")).filter(
      (file) => !readFileSync(file, "utf8").includes("boundedStripeFetch(unboundedFetch)"),
    );
    expect(unbounded).toEqual([]);
  });
});
