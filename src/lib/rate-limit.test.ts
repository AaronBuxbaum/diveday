import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkRateLimit,
  inMemoryRateLimitStore,
  RATE_LIMITS,
  type RateLimitConfig,
  type RateLimitStore,
  rateLimitKey,
  rateLimitStoreFromEnvironment,
  upstashRateLimitStore,
} from "./rate-limit";

/**
 * One stable mock instance across `vi.resetModules()`, so a freshly imported
 * copy of the module under test still reports into the same spy. The fail-open
 * reporter imports Sentry lazily (see its docblock), which `vi.mock` intercepts
 * exactly as it does a static import.
 */
const sentry = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => sentry);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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
  // The catch reports before it allows (see the suite below); these two cases
  // are about the return value, so the report is silenced rather than asserted.
  let logged: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logged = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    logged.mockRestore();
  });

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

/**
 * OPS-7: failing open is the policy, failing *silently* was the bug — a store
 * outage leaves every public write boundary in the app unprotected, and the
 * only way anyone found out was by noticing the abuse.
 *
 * The reporter damps itself to one report per minute per process and carries
 * the suppressed count, so these tests need a pristine module per case:
 * `vi.resetModules()` re-imports the module (and with it a fresh damper) while
 * the hoisted Sentry mock above stays the same object.
 */
describe("checkRateLimit — fail-open is observable", () => {
  const alwaysThrows: RateLimitStore = {
    take() {
      throw new TypeError("fetch failed");
    },
  };

  async function freshLimiter() {
    vi.resetModules();
    const { checkRateLimit: check } = await import("./rate-limit");
    return check;
  }

  let logged: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sentry.captureException.mockClear();
    logged = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logged.mockRestore();
  });

  function loggedEvents(): Array<Record<string, unknown>> {
    return logged.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0])));
  }

  it("still allows the request, and says so in the log and in Sentry", async () => {
    const check = await freshLimiter();
    const result = await check("k", config, 1_000, alwaysThrows);

    expect(result).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(loggedEvents()).toEqual([
      expect.objectContaining({
        event: "rate_limit.store_failed",
        level: "error",
        store: "injected",
        error: "TypeError",
        swallowed: 1,
      }),
    ]);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.captureException.mock.calls[0]?.[0]).toBeInstanceOf(TypeError);
  });

  it("never puts the key in the log line — it is not provably a hash", async () => {
    const check = await freshLimiter();
    // A call site passing an un-hashed key is exactly what must not leak.
    await check("diver@example.test", config, 1_000, alwaysThrows);

    expect(JSON.stringify(loggedEvents())).not.toContain("diver@example.test");
  });

  it("reports once per burst rather than once per request, and carries the suppressed count", async () => {
    const check = await freshLimiter();
    // Every public write boundary shares this seam, so a store outage means
    // one failure per request until it ends. Undamped, that is the whole
    // Sentry quota.
    for (let i = 0; i < 50; i++) await check("k", config, 1_000 + i, alwaysThrows);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(loggedEvents()).toHaveLength(1);

    // A minute later the incident is still worth a line — and the 49 failures
    // that went unreported are counted in it, so the rate survives the damping.
    await check("k", config, 1_000 + 60_000, alwaysThrows);
    expect(loggedEvents()[1]).toMatchObject({ swallowed: 50 });
    expect(sentry.captureException).toHaveBeenCalledTimes(2);
  });

  it("tags which store failed, so an Upstash incident is not confused with a bug in this file", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
    // Stubbed *before* the re-import, because the module picks its default
    // store — and that store captures its `fetch` — at load. A unit test must
    // not depend on a real DNS failure to produce the outage it is asserting
    // about: that would be a network round trip in `pnpm test`, and it would
    // pass for a reason (an unreachable host) other than the one under test.
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    vi.resetModules();
    const { checkRateLimit: check } = await import("./rate-limit");
    // No `store` argument: this exercises the module's *own* default store,
    // which is the only way the `upstash` tag can be reached at all.
    await check("k", config, 2_000);

    expect(loggedEvents()[0]).toMatchObject({ store: "upstash" });
    expect(sentry.captureException.mock.calls[0]?.[1]).toMatchObject({
      tags: { rate_limit_store: "upstash" },
    });
  });

  it("still allows the request when the reporter itself throws", async () => {
    const check = await freshLimiter();
    // Observability must never become the outage the fail-open policy exists
    // to prevent.
    sentry.captureException.mockImplementationOnce(() => {
      throw new Error("Sentry is down too");
    });
    await expect(check("k", config, 3_000, alwaysThrows)).resolves.toEqual({
      allowed: true,
      retryAfterMs: 0,
    });
  });
});

/**
 * The runbook drifted from the code once already (OPS-7: it promised 30/hour
 * for `capabilityAction` for a fortnight after a security review raised it to
 * 60), and a stale number in a runbook is worse than no number — it is read
 * during an incident and believed.
 *
 * This is a format check, not prose parsing: the runbook writes every figure as
 * `` `RATE_LIMITS.name` (capacity/window) ``, and this reads back exactly that
 * pattern wherever it appears. Anything else in the document is ignored.
 */
describe("rate-limiting runbook", () => {
  const runbook = readFileSync(
    path.join(process.cwd(), "docs/engineering/rate-limiting-runbook.md"),
    "utf8",
  );
  const documented = /`RATE_LIMITS\.([A-Za-z]+)`\s+\((\d+)\/(hour|15min)\)/g;

  /** The window a config's refill rate encodes, as the runbook spells it. */
  function policyText(config: RateLimitConfig): string {
    const windowMs = Math.round(config.capacity / config.refillPerMs);
    if (windowMs === 60 * 60 * 1000) return `${config.capacity}/hour`;
    if (windowMs === 15 * 60 * 1000) return `${config.capacity}/15min`;
    throw new Error(`RATE_LIMITS uses a window the runbook has no spelling for: ${windowMs}ms`);
  }

  it("states the same figure the code enforces, everywhere it states one", () => {
    const stated = [...runbook.matchAll(documented)];
    expect(stated.length).toBeGreaterThan(0);
    for (const [, name, capacity, window] of stated) {
      const config = RATE_LIMITS[name as keyof typeof RATE_LIMITS];
      expect(config, `runbook names RATE_LIMITS.${name}, which does not exist`).toBeDefined();
      expect(`${capacity}/${window}`, `runbook figure for RATE_LIMITS.${name}`).toBe(
        policyText(config),
      );
    }
  });

  it("documents every policy, so a new limit cannot ship undocumented", () => {
    const stated = new Set([...runbook.matchAll(documented)].map(([, name]) => name));
    expect([...Object.keys(RATE_LIMITS)].filter((name) => !stated.has(name))).toEqual([]);
  });
});

describe("checkRateLimit — e2e disable switch", () => {
  it("is set by `pnpm dev`, so a screenshot run against the dev server is never throttled", () => {
    // The e2e fleet has always set it (playwright.config.ts). The dev server
    // did not, and `node scripts/screenshot.mjs` signs in through the real
    // form against that server: with 8 sign-ins per email per 15 minutes
    // (`signInByEmail`), the second look of an afternoon was refused and the
    // session waited the window out. The `${VAR-1}` default keeps
    // `DIVEDAY_RATE_LIMIT_DISABLED=0 pnpm dev` as the way to watch the
    // limiter itself, and `rateLimitDisabled()` still refuses the switch
    // under a real DATABASE_URL, so this cannot reach a deployment.
    const { scripts } = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    expect(scripts.dev).toMatch(
      /DIVEDAY_RATE_LIMIT_DISABLED=\$\{DIVEDAY_RATE_LIMIT_DISABLED-1\} next dev/,
    );
  });

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
