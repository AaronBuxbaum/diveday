import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkoutProviderFromEnvironment } from "@/db/stripe-providers";
import {
  NO_ERROR_BODY,
  STRIPE_REQUEST_TIMEOUT_MS,
  stripeAnsweredStatus,
  stripeErrorTokens,
  stripeRequest,
} from "./stripe-client";

type FetchCall = [string, RequestInit & { headers: Record<string, string> }];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

/** A fetch that answers only when its signal aborts, as a hung Stripe would. */
function hungFetch() {
  return vi.fn(
    (_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  );
}

function closedConnection(code: "ECONNRESET" | "EPIPE") {
  return Object.assign(new Error("socket hang up"), { code });
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the request to reject");
}

const refund = {
  method: "POST" as const,
  path: "/v1/refunds",
  params: { payment_intent: "pi_1" },
  stripeAccount: "acct_123",
  idempotencyKey: "intent-1",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("what goes on the wire", () => {
  it("sends the call's own key, the connected account and the idempotency key, as a form", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ id: "re_1" }));
    await expect(stripeRequest("sk_test_one", fetchImpl, refund)).resolves.toEqual({ id: "re_1" });
    const [url, init] = fetchImpl.mock.calls[0] as FetchCall;
    expect(url).toBe("https://api.stripe.com/v1/refunds");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer sk_test_one",
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Account": "acct_123",
      "Idempotency-Key": "intent-1",
    });
    expect(String(init.body)).toBe("payment_intent=pi_1");
  });

  it("chooses the key per call, so a test key and a live key never share a client", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => json({ id: "re_1" }));
    await stripeRequest("sk_test_demo", fetchImpl, refund);
    await stripeRequest("sk_live_shop", fetchImpl, refund);
    const keys = (fetchImpl.mock.calls as FetchCall[]).map(
      ([, init]) => init.headers.Authorization,
    );
    expect(keys).toEqual(["Bearer sk_test_demo", "Bearer sk_live_shop"]);
  });

  /**
   * **The account's own API version, as before the SDK.** The SDK names its
   * release's version on every request; sending it would move every answer
   * to a shape the fixtures were not captured at (`stripe-api-version.test.ts`).
   */
  it("names no API version, so Stripe answers at the account's default", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ id: "re_1" }));
    await stripeRequest("sk_test_one", fetchImpl, refund);
    const [, init] = fetchImpl.mock.calls[0] as FetchCall;
    expect(Object.keys(init.headers).map((name) => name.toLowerCase())).not.toContain(
      "stripe-version",
    );
    expect(init.headers["X-Stripe-Client-Telemetry"]).toBeUndefined();
  });

  it("sends the OAuth calls to the Connect host", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ stripe_user_id: "acct_1" }));
    await stripeRequest("sk_test_one", fetchImpl, {
      method: "POST",
      path: "/oauth/token",
      connectHost: true,
      params: { grant_type: "authorization_code", code: "ac_1" },
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://connect.stripe.com/oauth/token");
  });
});

describe("how long a call may take", () => {
  it("is ten seconds by default, then the call ends with no answer", async () => {
    vi.useFakeTimers();
    const fetchImpl = hungFetch();
    const pending = rejection(stripeRequest("sk_test_one", fetchImpl, refund));
    await vi.advanceTimersByTimeAsync(STRIPE_REQUEST_TIMEOUT_MS - 1);
    expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const error = await pending;
    expect(stripeAnsweredStatus(error)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(STRIPE_REQUEST_TIMEOUT_MS).toBe(10_000);
  });

  it("waits longer only for a call that asks", async () => {
    vi.useFakeTimers();
    const fetchImpl = hungFetch();
    const pending = rejection(
      stripeRequest("sk_test_one", fetchImpl, { ...refund, timeoutMs: 30_000 }),
    );
    await vi.advanceTimersByTimeAsync(STRIPE_REQUEST_TIMEOUT_MS + 1);
    expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(stripeAnsweredStatus(await pending)).toBeNull();
  });
});

/**
 * **Exactly one request per call.** The SDK retries a closed connection once
 * even at `maxNetworkRetries: 0`, and such a connection can close after Stripe
 * acted on a refund. The caller decides `unanswered`; the SDK does not get to
 * send it again behind its back.
 */
describe("retries", () => {
  it.each(["ECONNRESET", "EPIPE"] as const)(
    "never resends a mutation whose connection closed (%s)",
    async (code) => {
      const fetchImpl = vi.fn().mockRejectedValue(closedConnection(code));
      const error = await rejection(stripeRequest("sk_test_one", fetchImpl, refund));
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(stripeAnsweredStatus(error)).toBeNull();
    },
  );

  it.each([409, 429, 500, 503])("never resends after a %i either", async (status) => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(json({ error: { type: "api_error", code: "lock_timeout" } }, status));
    const error = await rejection(stripeRequest("sk_test_one", fetchImpl, refund));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(stripeAnsweredStatus(error)).toBe(status);
  });
});

describe("telling an answer from silence", () => {
  it("reads a refusal's status and its code and type, never its message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      json(
        {
          error: {
            type: "invalid_request_error",
            code: "resource_missing",
            message: "No such customer: diver@example.com",
          },
        },
        404,
      ),
    );
    const error = await rejection(stripeRequest("sk_test_one", fetchImpl, refund));
    expect(stripeAnsweredStatus(error)).toBe(404);
    expect(stripeErrorTokens(error)).toEqual({
      code: "resource_missing",
      type: "invalid_request_error",
    });
  });

  /**
   * The SDK reads any JSON without an `error` field as an answer, whatever its
   * status; a gateway's `{}` with a 500 would have been a refund that worked.
   */
  it("never reads a non-2xx as a success, whatever its body", async () => {
    for (const body of [JSON.stringify({ id: "re_1" }), "<html>Bad gateway</html>", ""]) {
      const fetchImpl = vi.fn().mockResolvedValue(new Response(body, { status: 502 }));
      const error = await rejection(stripeRequest("sk_test_one", fetchImpl, refund));
      expect(stripeAnsweredStatus(error)).toBe(502);
      expect(stripeErrorTokens(error).type).toBeUndefined();
    }
    expect(NO_ERROR_BODY).toMatch(/^[a-z_]+$/);
  });

  it("calls a 2xx that is not JSON no answer, since Stripe may have acted", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    expect(
      stripeAnsweredStatus(await rejection(stripeRequest("sk", fetchImpl, refund))),
    ).toBeNull();
  });

  it("calls a thrown fetch no answer", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    expect(
      stripeAnsweredStatus(await rejection(stripeRequest("sk", fetchImpl, refund))),
    ).toBeNull();
    expect(stripeAnsweredStatus(new Error("anything"))).toBeNull();
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
    expect(await provider.createCheckoutSession(request)).toEqual({ status: "failed" });
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
  const session = {
    id: "cs_1",
    status: "complete",
    payment_status: "paid",
    amount_total: 1_000,
    payment_intent: "pi_1",
  };
  const provider = (fetchImpl: unknown) =>
    checkoutProviderFromEnvironment(
      { STRIPE_SECRET_KEY: "sk_test_x" },
      fetchImpl as unknown as typeof fetch,
    );

  it.each([
    ["timed out", new DOMException("The operation was aborted", "TimeoutError")],
    ["reset", closedConnection("ECONNRESET")],
    ["broke", closedConnection("EPIPE")],
  ])("is unanswered, never failed, once the refund itself went out (%s)", async (_, thrown) => {
    // A `failed` here let the caller resolve the intent and the next press
    // mint a fresh idempotency key: a second real reversal (fifth review).
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(session)).mockRejectedValueOnce(thrown);
    expect(await provider(fetchImpl).refundCheckoutSession("acct_123", "cs_1", "intent-1")).toEqual(
      { status: "unanswered" },
    );
    // The lookup and the refund, and the refund once.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("is failed when Stripe refused the refund: it answered, and nothing moved", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(session))
      .mockResolvedValueOnce(json({ error: { type: "invalid_request_error" } }, 400));
    expect(await provider(fetchImpl).refundCheckoutSession("acct_123", "cs_1", "intent-1")).toEqual(
      { status: "failed" },
    );
  });

  it("is failed while only the lookup timed out, since nothing was asked of Stripe", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("The operation was aborted", "TimeoutError"));
    expect(await provider(fetchImpl).refundCheckoutSession("acct_123", "cs_1", "intent-1")).toEqual(
      { status: "failed" },
    );
  });
});

/** Source files under `src` that load the SDK, or name a Stripe host. */
function stripeSources(dir: string): { sdk: string[]; host: string[] } {
  const found = { sdk: [] as string[], host: [] as string[] };
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      const inner = stripeSources(full);
      found.sdk.push(...inner.sdk);
      found.host.push(...inner.host);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      const source = readFileSync(full, "utf8");
      const file = path.relative(process.cwd(), full);
      if (/from "stripe"/.test(source)) found.sdk.push(file);
      if (/(api|connect)\.stripe\.com/.test(source) && /\b\w*[fF]etch\w*\s*\(/.test(source)) {
        found.host.push(file);
      }
    }
  }
  return { sdk: found.sdk.sort(), host: found.host.sort() };
}

describe("every Stripe adapter", () => {
  it("reaches Stripe only through stripe-client.ts", () => {
    const { sdk, host } = stripeSources(path.join(process.cwd(), "src"));
    // The client, and the webhook's signature check. A third file loading the
    // SDK would be a client built without the policies above.
    expect(sdk).toEqual(["src/lib/payments/stripe-client.ts", "src/lib/payments/webhook.ts"]);
    // No file fetches a Stripe host by hand: only the client names one beside
    // a fetch, and that fetch is the SDK's transport.
    expect(host).toEqual(["src/lib/payments/stripe-client.ts"]);
    const webhook = readFileSync("src/lib/payments/webhook.ts", "utf8");
    expect(webhook).not.toMatch(/new Stripe\(/);
  });
});
