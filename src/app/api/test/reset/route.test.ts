import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/seed", () => ({
  resetDemoSchedule: vi.fn(),
  purgeMintedDemoShops: vi.fn(),
}));
vi.mock("@/db/shops", () => ({ getShopBySlug: vi.fn() }));

const { getDb } = await import("@/db/client");
const { resetDemoSchedule, purgeMintedDemoShops } = await import("@/db/seed");
const { getShopBySlug } = await import("@/db/shops");
const { POST } = await import("./route");

// `execute` is what the route reclaims dead tuples through; a bare object
// would make that call throw into the route's own catch and the assertion
// below would pass for the wrong reason.
const FAKE_DB = { fake: "db", execute: vi.fn() };
const secret = "e2e-test-secret";

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
  vi.mocked(resetDemoSchedule)
    .mockReset()
    .mockResolvedValue(undefined as never);
  vi.mocked(purgeMintedDemoShops)
    .mockReset()
    .mockResolvedValue(undefined as never);
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
    expect(resetDemoSchedule).not.toHaveBeenCalled();
  });

  it("404s with the wrong bearer token", async () => {
    const response = await POST(resetRequest("Bearer wrong-secret"));
    expect(response.status).toBe(404);
    expect(resetDemoSchedule).not.toHaveBeenCalled();
  });

  it("404s when DIVEDAY_E2E_SECRET isn't configured at all, regardless of the header sent", async () => {
    vi.stubEnv("DIVEDAY_E2E_SECRET", "");
    const response = await POST(resetRequest(`Bearer ${secret}`));
    expect(response.status).toBe(404);
    expect(resetDemoSchedule).not.toHaveBeenCalled();
  });

  it("404s whenever a real database is configured, even with the correct secret", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://example");
    const response = await POST(resetRequest(`Bearer ${secret}`));
    expect(response.status).toBe(404);
    expect(resetDemoSchedule).not.toHaveBeenCalled();
  });

  it("succeeds with the correct bearer token", async () => {
    const response = await POST(resetRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(resetDemoSchedule).toHaveBeenCalledWith(FAKE_DB, "shop_1", { history: true });
    expect(purgeMintedDemoShops).toHaveBeenCalledWith(FAKE_DB);
    // And reclaims what it just deleted — see the route's own comment for why
    // a run of this endpoint that skips it degrades a whole local e2e suite.
    expect(FAKE_DB.execute).toHaveBeenCalledTimes(1);
  });

  it("still resets when the runtime refuses the reclaim", async () => {
    // A reset whose fixture is already restored must not fail over
    // housekeeping — the only cost of a skipped reclaim is slow growth.
    FAKE_DB.execute.mockRejectedValue(new Error("VACUUM cannot run inside a transaction block"));
    const response = await POST(resetRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(resetDemoSchedule).toHaveBeenCalled();
  });
});
