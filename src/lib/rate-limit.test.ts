import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkRateLimit,
  inMemoryRateLimitStore,
  type RateLimitStore,
  rateLimitKey,
  rateLimitStoreFromEnvironment,
  upstashRateLimitStore,
} from "./rate-limit";

afterEach(() => {
  vi.unstubAllEnvs();
});

const config = { capacity: 3, refillPerMs: 1 / 1000 }; // 3 burst, 1 token/sec refill

describe("checkRateLimit — burst", () => {
  it("allows up to capacity requests instantly, then rejects", async () => {
    const store = inMemoryRateLimitStore();
    const now = 1_000_000;
    expect((await checkRateLimit("k", config, now, store)).allowed).toBe(true);
    expect((await checkRateLimit("k", config, now, store)).allowed).toBe(true);
    expect((await checkRateLimit("k", config, now, store)).allowed).toBe(true);
    const fourth = await checkRateLimit("k", config, now, store);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });
});

describe("checkRateLimit — refill", () => {
  it("regains exactly one token after one refill interval, not more", async () => {
    const store = inMemoryRateLimitStore();
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) await checkRateLimit("k", config, now, store);
    expect((await checkRateLimit("k", config, now, store)).allowed).toBe(false);

    // 1000ms later, at 1 token/sec, exactly one token has regenerated.
    expect((await checkRateLimit("k", config, now + 1000, store)).allowed).toBe(true);
    expect((await checkRateLimit("k", config, now + 1000, store)).allowed).toBe(false);
  });

  it("never refills past capacity even after a long idle period", async () => {
    const store = inMemoryRateLimitStore();
    const now = 1_000_000;
    await checkRateLimit("k", config, now, store);
    // A huge gap — tokens must cap at `capacity`, not overflow.
    const muchLater = now + 1_000_000_000;
    expect((await checkRateLimit("k", config, muchLater, store)).allowed).toBe(true);
    expect((await checkRateLimit("k", config, muchLater, store)).allowed).toBe(true);
    expect((await checkRateLimit("k", config, muchLater, store)).allowed).toBe(true);
    expect((await checkRateLimit("k", config, muchLater, store)).allowed).toBe(false);
  });
});

describe("checkRateLimit — cross-key isolation", () => {
  it("never lets one key's usage affect another's budget", async () => {
    const store = inMemoryRateLimitStore();
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) await checkRateLimit("shop-a", config, now, store);
    expect((await checkRateLimit("shop-a", config, now, store)).allowed).toBe(false);
    // A different key (a different tenant/IP/token) starts with its own full bucket.
    expect((await checkRateLimit("shop-b", config, now, store)).allowed).toBe(true);
  });
});

describe("checkRateLimit — fail-open", () => {
  it("allows the request when the store throws instead of propagating the error", async () => {
    const throwingStore: RateLimitStore = {
      take() {
        throw new Error("store unavailable");
      },
    };
    const result = await checkRateLimit("k", config, 0, throwingStore);
    expect(result).toEqual({ allowed: true, retryAfterMs: 0 });
  });

  it("allows the request when an async store's promise rejects", async () => {
    const throwingStore: RateLimitStore = {
      async take() {
        throw new Error("network timeout");
      },
    };
    const result = await checkRateLimit("k", config, 0, throwingStore);
    expect(result).toEqual({ allowed: true, retryAfterMs: 0 });
  });
});

describe("checkRateLimit — e2e disable switch", () => {
  it("allows unlimited requests when DIVEDAY_RATE_LIMIT_DISABLED=1 and no real database is configured", async () => {
    vi.stubEnv("DIVEDAY_RATE_LIMIT_DISABLED", "1");
    vi.stubEnv("DATABASE_URL", "");
    const store = inMemoryRateLimitStore();
    for (let i = 0; i < 10; i++) {
      expect((await checkRateLimit("k", config, 0, store)).allowed).toBe(true);
    }
  });

  it("never disables rate limiting when a real database is configured, whatever else is set", async () => {
    vi.stubEnv("DIVEDAY_RATE_LIMIT_DISABLED", "1");
    vi.stubEnv("DATABASE_URL", "postgres://example");
    const store = inMemoryRateLimitStore();
    for (let i = 0; i < 3; i++) await checkRateLimit("k", config, 0, store);
    expect((await checkRateLimit("k", config, 0, store)).allowed).toBe(false);
  });
});

describe("rateLimitKey", () => {
  it("never contains the raw input value", () => {
    const key = rateLimitKey("waiver-token", "super-secret-bearer-token-value");
    expect(key).not.toContain("super-secret-bearer-token-value");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same parts and distinct for different ones", () => {
    expect(rateLimitKey("a", "b")).toBe(rateLimitKey("a", "b"));
    expect(rateLimitKey("a", "b")).not.toBe(rateLimitKey("a", "c"));
  });

  it("treats null/undefined parts consistently rather than throwing", () => {
    expect(() => rateLimitKey("a", null, undefined)).not.toThrow();
  });
});

/**
 * ADR 20260801-distributed-rate-limit-store. A fake `fetch` stands in for
 * Upstash's REST API, simulating the same server-side Lua token bucket the
 * real EVAL script runs, so these tests exercise the HTTP request shape and
 * response parsing without a live Redis.
 */
function fakeUpstash() {
  const buckets = new Map<string, { tokens: number; updatedAt: number }>();
  const requests: Array<{ url: string; body: unknown[]; authorization: string | null }> = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    requests.push({
      url: String(url),
      body,
      authorization: (init?.headers as Record<string, string> | undefined)?.authorization ?? null,
    });
    const [, , , key, capacityStr, refillStr, nowStr] = body as string[];
    const capacity = Number(capacityStr);
    const refillPerMs = Number(refillStr);
    const now = Number(nowStr);
    const existing = buckets.get(key);
    let tokens = existing ? existing.tokens : capacity;
    const updatedAt = existing ? existing.updatedAt : now;
    tokens = Math.min(capacity, tokens + Math.max(0, now - updatedAt) * refillPerMs);
    const allowed = tokens >= 1;
    if (allowed) tokens -= 1;
    buckets.set(key, { tokens, updatedAt: now });
    return {
      ok: true,
      json: async () => ({ result: [allowed ? 1 : 0, String(tokens)] }),
    };
  }) as unknown as typeof fetch;
  return { fetchImpl, requests, buckets };
}

describe("upstashRateLimitStore", () => {
  it("sends an EVAL request authorized with the configured token", async () => {
    const { fetchImpl, requests } = fakeUpstash();
    const store = upstashRateLimitStore(
      { url: "https://example.upstash.io", token: "test-token" },
      fetchImpl,
    );
    await store.take("k", config, 0);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://example.upstash.io");
    expect(requests[0]?.authorization).toBe("Bearer test-token");
    expect(requests[0]?.body[0]).toBe("EVAL");
  });

  it("enforces burst capacity the same as the in-memory store", async () => {
    const { fetchImpl } = fakeUpstash();
    const store = upstashRateLimitStore(
      { url: "https://example.upstash.io", token: "test-token" },
      fetchImpl,
    );
    expect((await store.take("k", config, 0)).allowed).toBe(true);
    expect((await store.take("k", config, 0)).allowed).toBe(true);
    expect((await store.take("k", config, 0)).allowed).toBe(true);
    const fourth = await store.take("k", config, 0);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it("shares state across two independently-constructed stores hitting the same backend — the whole point of a distributed store", async () => {
    const { fetchImpl } = fakeUpstash();
    const instanceA = upstashRateLimitStore(
      { url: "https://example.upstash.io", token: "test-token" },
      fetchImpl,
    );
    const instanceB = upstashRateLimitStore(
      { url: "https://example.upstash.io", token: "test-token" },
      fetchImpl,
    );
    await instanceA.take("shared-key", config, 0);
    await instanceB.take("shared-key", config, 0);
    await instanceA.take("shared-key", config, 0);
    // Capacity 3 consumed across both "instances" — the fourth take anywhere fails.
    expect((await instanceB.take("shared-key", config, 0)).allowed).toBe(false);
  });

  it("throws (fail-open via checkRateLimit) when Upstash responds with an error status", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
    const store = upstashRateLimitStore(
      { url: "https://example.upstash.io", token: "test-token" },
      fetchImpl,
    );
    const result = await checkRateLimit("k", config, 0, store);
    expect(result).toEqual({ allowed: true, retryAfterMs: 0 });
  });

  it("throws (fail-open via checkRateLimit) on a malformed response body", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      json: async () => ({ unexpected: "shape" }),
    })) as unknown as typeof fetch;
    const store = upstashRateLimitStore(
      { url: "https://example.upstash.io", token: "test-token" },
      fetchImpl,
    );
    const result = await checkRateLimit("k", config, 0, store);
    expect(result).toEqual({ allowed: true, retryAfterMs: 0 });
  });
});

describe("rateLimitStoreFromEnvironment", () => {
  it("falls back to the in-memory store when Upstash env vars are absent", async () => {
    const store = rateLimitStoreFromEnvironment({});
    // In-memory store enforces burst capacity synchronously with no network call.
    expect((await store.take("k", config, 0)).allowed).toBe(true);
  });

  it("uses the distributed store when both Upstash env vars are set", async () => {
    const { fetchImpl, requests } = fakeUpstash();
    const store = rateLimitStoreFromEnvironment(
      {
        UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
        UPSTASH_REDIS_REST_TOKEN: "test-token",
      },
      fetchImpl,
    );
    await store.take("k", config, 0);
    expect(requests).toHaveLength(1);
  });

  it("falls back to in-memory when only one of the two Upstash env vars is set", async () => {
    const { fetchImpl, requests } = fakeUpstash();
    const store = rateLimitStoreFromEnvironment(
      { UPSTASH_REDIS_REST_URL: "https://example.upstash.io" },
      fetchImpl,
    );
    await store.take("k", config, 0);
    expect(requests).toHaveLength(0);
  });
});
