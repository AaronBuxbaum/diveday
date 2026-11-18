import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkRateLimit,
  checkRateLimitFailClosed,
  inMemoryRateLimitStore,
  RATE_LIMITS,
  type RateLimitConfig,
  type RateLimitStore,
  rateLimitKey,
  refundRateLimit,
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
      refund() {},
    };
    const result = await checkRateLimit("k", config, 0, throwingStore);
    expect(result).toEqual({ allowed: true, retryAfterMs: 0 });
  });

  it("allows the request when an async store's promise rejects", async () => {
    const throwingStore: RateLimitStore = {
      async take() {
        throw new Error("network timeout");
      },
      refund() {},
    };
    const result = await checkRateLimit("k", config, 0, throwingStore);
    expect(result).toEqual({ allowed: true, retryAfterMs: 0 });
  });
});

/**
 * **One bucket fails closed**: the doctor's page's date-of-birth unlock
 * (second-pass security review of layer r5-3, N4), the first limit standing in
 * front of medical answers. A store outage there refuses the try rather than
 * letting every guess through; the diver loses nothing they cannot get from
 * their doctor's whole-questionnaire visit.
 */
describe("checkRateLimitFailClosed", () => {
  it("refuses when the store throws, and still allows a request the store allows", async () => {
    const throwingStore: RateLimitStore = {
      async take() {
        throw new Error("network timeout");
      },
      refund() {},
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await checkRateLimitFailClosed("k", config, 0, throwingStore)).toMatchObject({
      allowed: false,
    });
    expect(await checkRateLimitFailClosed("k", config, 0, inMemoryRateLimitStore())).toEqual({
      allowed: true,
      retryAfterMs: 0,
    });
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
    refund() {},
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

  it("tags which store failed, so a database incident is not confused with a bug in this file", async () => {
    // A deployment installs the Postgres store at boot; its outage is tagged apart from this file's own.
    const check = await freshLimiter();
    const { setDefaultRateLimitStore } = await import("./rate-limit");
    setDefaultRateLimitStore(alwaysThrows, "postgres");
    // No `store` argument: this exercises the module's *own* default store.
    await check("k", config, 2_000);

    expect(loggedEvents()[0]).toMatchObject({ store: "postgres" });
    expect(sentry.captureException.mock.calls[0]?.[1]).toMatchObject({
      tags: { rate_limit_store: "postgres" },
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
  const documented = /`RATE_LIMITS\.([A-Za-z]+)`\s+\((\d+)\/(hour|15min|day)\)/g;

  /** The window a config's refill rate encodes, as the runbook spells it. */
  function policyText(config: RateLimitConfig): string {
    const windowMs = Math.round(config.capacity / config.refillPerMs);
    if (windowMs === 60 * 60 * 1000) return `${config.capacity}/hour`;
    if (windowMs === 15 * 60 * 1000) return `${config.capacity}/15min`;
    if (windowMs === 24 * 60 * 60 * 1000) return `${config.capacity}/day`;
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
    // session waited the window out. The `??=` default keeps
    // `DIVEDAY_RATE_LIMIT_DISABLED=0 pnpm dev` as the way to watch the
    // limiter itself, and `rateLimitDisabled()` still refuses the switch
    // under a real DATABASE_URL, so this cannot reach a deployment.
    //
    // Asserted against the supervisor rather than the `dev` script since ADR
    // 20260903-the-dev-server-is-supervised: the default used to be a shell
    // prefix in package.json, which meant it applied to `pnpm dev` and to no
    // other way of starting the app — including the bare
    // `node scripts/dev-server.mjs` that AGENTS.md's `pnpm dev` row now names.
    // Both halves are pinned, because the guarantee needs the default to exist
    // *and* the script to route through the file that sets it.
    const { scripts } = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    expect(scripts.dev).toMatch(/node scripts\/dev-server\.mjs/);
    const supervisor = readFileSync(path.join(process.cwd(), "scripts/dev-server.mjs"), "utf8");
    expect(supervisor).toMatch(/env\.DIVEDAY_RATE_LIMIT_DISABLED \?\?= "1"/);
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

describe("refundRateLimit", () => {
  it("gives back one spent token, never past capacity, and ignores a key it never saw", async () => {
    const store = inMemoryRateLimitStore();
    await refundRateLimit("unseen", config, 0, store);
    for (let i = 0; i < 3; i++) await store.take("k", config, 0);
    expect((await store.take("k", config, 0)).allowed).toBe(false);
    await refundRateLimit("k", config, 0, store);
    expect((await store.take("k", config, 0)).allowed).toBe(true);
    expect((await store.take("k", config, 0)).allowed).toBe(false);
    await refundRateLimit("k", config, 0, store);
    await refundRateLimit("k", config, 0, store);
    await refundRateLimit("k", config, 0, store);
    await refundRateLimit("k", config, 0, store);
    for (let i = 0; i < 3; i++) expect((await store.take("k", config, 0)).allowed).toBe(true);
    expect((await store.take("k", config, 0)).allowed).toBe(false);
  });

  it("never throws when the store does", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const store: RateLimitStore = {
      take: () => ({ allowed: true, retryAfterMs: 0 }),
      refund() {
        throw new Error("network timeout");
      },
    };
    await expect(refundRateLimit("k", config, 0, store)).resolves.toBeUndefined();
  });
});
