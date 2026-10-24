import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/seed", () => ({
  purgeMintedDemoShops: vi.fn(),
}));
vi.mock("@/db/demo-reset-snapshot", () => ({
  resetDemoFromSnapshot: vi.fn(),
}));
vi.mock("@/db/shops", () => ({ getShopBySlug: vi.fn() }));

const { getDb } = await import("@/db/client");
const { purgeMintedDemoShops } = await import("@/db/seed");
const { resetDemoFromSnapshot } = await import("@/db/demo-reset-snapshot");
const { getShopBySlug } = await import("@/db/shops");
const { POST } = await import("./route");

// `execute` is what the route reclaims dead tuples through; a bare object
// would make that call throw into the route's own catch and the assertion
// below would pass for the wrong reason.
const FAKE_DB = { fake: "db", execute: vi.fn() };
const secret = "e2e-test-secret";

/** The statement the route reclaimed dead tuples with. */
function vacuumed(): string {
  const [query] = FAKE_DB.execute.mock.calls[0] as unknown as [SQL];
  return new PgDialect().sqlToQuery(query).sql;
}

function resetRequest(authorization?: string) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return new Request("http://localhost/api/test/reset", { method: "POST", headers });
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("DIVEDAY_E2E_SECRET", secret);
  FAKE_DB.execute.mockReset().mockResolvedValue(undefined as never);
  vi.mocked(getDb).mockResolvedValue(FAKE_DB as never);
  vi.mocked(getShopBySlug)
    .mockReset()
    .mockResolvedValue({ id: "shop_1", isDemo: true } as never);
  vi.mocked(resetDemoFromSnapshot)
    .mockReset()
    .mockResolvedValue({ mode: "snapshot", wrote: ["bookings", "trips"] });
  vi.mocked(purgeMintedDemoShops).mockReset().mockResolvedValue(0);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/test/reset — auth gate (specialist-optimization-audit-20260731.md §5)", () => {
  it("404s with a missing Authorization header, even with DIVEDAY_E2E=1 in a production-shaped runtime", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DIVEDAY_E2E", "1");
    const response = await POST(resetRequest());
    expect(response.status).toBe(404);
    expect(resetDemoFromSnapshot).not.toHaveBeenCalled();
  });

  it("404s with the wrong bearer token", async () => {
    const response = await POST(resetRequest("Bearer wrong-secret"));
    expect(response.status).toBe(404);
    expect(resetDemoFromSnapshot).not.toHaveBeenCalled();
  });

  it("404s when DIVEDAY_E2E_SECRET isn't configured at all, regardless of the header sent", async () => {
    vi.stubEnv("DIVEDAY_E2E_SECRET", "");
    const response = await POST(resetRequest(`Bearer ${secret}`));
    expect(response.status).toBe(404);
    expect(resetDemoFromSnapshot).not.toHaveBeenCalled();
  });

  it("404s whenever a real database is configured, even with the correct secret", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://example");
    const response = await POST(resetRequest(`Bearer ${secret}`));
    expect(response.status).toBe(404);
    expect(resetDemoFromSnapshot).not.toHaveBeenCalled();
  });

  it("succeeds with the correct bearer token", async () => {
    const response = await POST(resetRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(resetDemoFromSnapshot).toHaveBeenCalledWith(FAKE_DB, "shop_1");
    expect(purgeMintedDemoShops).toHaveBeenCalledWith(FAKE_DB);
    // And reclaims what it just deleted — see the route's own comment for why
    // a run of this endpoint that skips it degrades a whole local e2e suite.
    expect(FAKE_DB.execute).toHaveBeenCalledTimes(1);
    // And says how it was served and what it cost, so a slow reset can be read
    // off a request log rather than inferred from a test's budget.
    expect(await response.json()).toMatchObject({ ok: true, mode: "snapshot" });
    expect(response.headers.get("Server-Timing")).toMatch(
      /^reset;dur=[\d.]+;desc="snapshot", purge;dur=[\d.]+, vacuum;dur=[\d.]+, total;dur=[\d.]+$/,
    );
  });

  it("vacuums only the tables a replay wrote", async () => {
    await POST(resetRequest(`Bearer ${secret}`));
    expect(vacuumed()).toBe('vacuum public."bookings", public."trips"');
  });

  it("vacuums everything after a real reset or a purge of minted shops", async () => {
    vi.mocked(resetDemoFromSnapshot).mockResolvedValue({ mode: "captured", wrote: null });
    await POST(resetRequest(`Bearer ${secret}`));
    expect(vacuumed()).toBe("vacuum");

    FAKE_DB.execute.mockClear();
    vi.mocked(resetDemoFromSnapshot).mockResolvedValue({ mode: "snapshot", wrote: ["trips"] });
    vi.mocked(purgeMintedDemoShops).mockResolvedValue(2);
    await POST(resetRequest(`Bearer ${secret}`));
    expect(vacuumed()).toBe("vacuum");
  });

  it("leaves a shop that is not a demo alone", async () => {
    vi.mocked(getShopBySlug).mockResolvedValue({ id: "shop_1", isDemo: false } as never);
    const response = await POST(resetRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(resetDemoFromSnapshot).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ mode: "skipped" });
  });

  it("still resets when the runtime refuses the reclaim", async () => {
    // A reset whose fixture is already restored must not fail over
    // housekeeping — the only cost of a skipped reclaim is slow growth.
    FAKE_DB.execute.mockRejectedValue(new Error("VACUUM cannot run inside a transaction block"));
    const response = await POST(resetRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(resetDemoFromSnapshot).toHaveBeenCalled();
  });
});
