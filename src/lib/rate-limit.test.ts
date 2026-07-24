import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkRateLimit,
  inMemoryRateLimitStore,
  type RateLimitStore,
  rateLimitKey,
} from "./rate-limit";

afterEach(() => {
  vi.unstubAllEnvs();
});

const config = { capacity: 3, refillPerMs: 1 / 1000 }; // 3 burst, 1 token/sec refill

describe("checkRateLimit — burst", () => {
  it("allows up to capacity requests instantly, then rejects", () => {
    const store = inMemoryRateLimitStore();
    const now = 1_000_000;
    expect(checkRateLimit("k", config, now, store).allowed).toBe(true);
    expect(checkRateLimit("k", config, now, store).allowed).toBe(true);
    expect(checkRateLimit("k", config, now, store).allowed).toBe(true);
    const fourth = checkRateLimit("k", config, now, store);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });
});

describe("checkRateLimit — refill", () => {
  it("regains exactly one token after one refill interval, not more", () => {
    const store = inMemoryRateLimitStore();
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit("k", config, now, store);
    expect(checkRateLimit("k", config, now, store).allowed).toBe(false);

    // 1000ms later, at 1 token/sec, exactly one token has regenerated.
    expect(checkRateLimit("k", config, now + 1000, store).allowed).toBe(true);
    expect(checkRateLimit("k", config, now + 1000, store).allowed).toBe(false);
  });

  it("never refills past capacity even after a long idle period", () => {
    const store = inMemoryRateLimitStore();
    const now = 1_000_000;
    checkRateLimit("k", config, now, store);
    // A huge gap — tokens must cap at `capacity`, not overflow.
    const muchLater = now + 1_000_000_000;
    expect(checkRateLimit("k", config, muchLater, store).allowed).toBe(true);
    expect(checkRateLimit("k", config, muchLater, store).allowed).toBe(true);
    expect(checkRateLimit("k", config, muchLater, store).allowed).toBe(true);
    expect(checkRateLimit("k", config, muchLater, store).allowed).toBe(false);
  });
});

describe("checkRateLimit — cross-key isolation", () => {
  it("never lets one key's usage affect another's budget", () => {
    const store = inMemoryRateLimitStore();
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit("shop-a", config, now, store);
    expect(checkRateLimit("shop-a", config, now, store).allowed).toBe(false);
    // A different key (a different tenant/IP/token) starts with its own full bucket.
    expect(checkRateLimit("shop-b", config, now, store).allowed).toBe(true);
  });
});

describe("checkRateLimit — fail-open", () => {
  it("allows the request when the store throws instead of propagating the error", () => {
    const throwingStore: RateLimitStore = {
      take() {
        throw new Error("store unavailable");
      },
    };
    const result = checkRateLimit("k", config, 0, throwingStore);
    expect(result).toEqual({ allowed: true, retryAfterMs: 0 });
  });
});

describe("checkRateLimit — e2e disable switch", () => {
  it("allows unlimited requests when DIVEDAY_RATE_LIMIT_DISABLED=1 and no real database is configured", () => {
    vi.stubEnv("DIVEDAY_RATE_LIMIT_DISABLED", "1");
    vi.stubEnv("DATABASE_URL", "");
    const store = inMemoryRateLimitStore();
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit("k", config, 0, store).allowed).toBe(true);
    }
  });

  it("never disables rate limiting when a real database is configured, whatever else is set", () => {
    vi.stubEnv("DIVEDAY_RATE_LIMIT_DISABLED", "1");
    vi.stubEnv("DATABASE_URL", "postgres://example");
    const store = inMemoryRateLimitStore();
    for (let i = 0; i < 3; i++) checkRateLimit("k", config, 0, store);
    expect(checkRateLimit("k", config, 0, store).allowed).toBe(false);
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
