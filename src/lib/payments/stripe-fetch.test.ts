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

  it("ends a timed-out request as failed, so the transaction holding the seat lets go", async () => {
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

/** Every non-test source file under `src` that calls Stripe's API through an injected fetch. */
function stripeCallers(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) found.push(...stripeCallers(full));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      const source = readFileSync(full, "utf8");
      if (
        name !== "stripe-fetch.ts" &&
        /(api|connect)\.stripe\.com/.test(source) &&
        source.includes("fetchImpl(")
      ) {
        found.push(full);
      }
    }
  }
  return found;
}

describe("every Stripe adapter", () => {
  it("wraps its fetch in boundedStripeFetch", () => {
    const callers = stripeCallers(path.join(process.cwd(), "src"));
    expect(callers.length).toBeGreaterThanOrEqual(8);
    const unbounded = callers.filter(
      (file) => !readFileSync(file, "utf8").includes("boundedStripeFetch(unboundedFetch)"),
    );
    expect(unbounded.map((file) => path.relative(process.cwd(), file))).toEqual([]);
  });
});
