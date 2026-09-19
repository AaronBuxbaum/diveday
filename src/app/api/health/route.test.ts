import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocked although the route no longer imports it — that is the point. A future
// edit that reintroduces a database read here would reintroduce the cost ADR
// 20260919-health-check-does-not-wake-the-database removed, silently and with
// every test still green. Asserting `getDb` is never called is what makes that
// edit fail instead.
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
// `connection()` needs a real request scope, which a unit test has no way to
// provide; the route's use of it is a build-time concern (see its comment), so
// stub it and assert only that it is awaited before anything else happens.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, connection: vi.fn(async () => {}) };
});

const { getDb } = await import("@/db/client");
const { connection } = await import("next/server");
const { GET } = await import("./route");

const SHA = "0123456789abcdef0123456789abcdef01234567";

beforeEach(() => {
  vi.mocked(connection).mockClear();
  vi.mocked(getDb).mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.mocked(console.error).mockRestore();
  vi.unstubAllEnvs();
});

describe("GET /api/health", () => {
  it("reports ok and the short commit SHA", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", SHA);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", commit: "0123456" });
  });

  /**
   * The load-bearing assertion of the whole route.
   *
   * Route 53's 30-second interval delivers a request about every two seconds
   * once every checker region is counted, and Neon's compute scales to zero
   * only after five idle minutes. One `select 1` in this handler is therefore
   * not one query — it is a compute that is never allowed to sleep, and a
   * database bill set by the monitor's cadence rather than by anybody using
   * the product.
   */
  it("never touches the database, so the probe cannot pin the compute awake", async () => {
    await GET();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("waits for a connection so the probe is never prerendered at build time", async () => {
    await GET();
    expect(connection).toHaveBeenCalledTimes(1);
  });

  it("reports an unknown commit off-platform rather than failing", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", commit: "unknown" });
  });

  it("never leaks env values in the body", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://app:hunter2@db.internal.example:5432/diveday");

    const body = await (await GET()).text();

    expect(body).not.toContain("db.internal.example");
    expect(body).not.toContain("hunter2");
    expect(body).not.toContain("5432");
    // Exactly two fields, so a future edit can't quietly widen the disclosure.
    expect(Object.keys(JSON.parse(body))).toEqual(["status", "commit"]);
  });

  it("discloses only the short SHA, never the full commit", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", SHA);

    const body = (await (await GET()).json()) as { commit: string };

    expect(body.commit).toHaveLength(7);
    expect(SHA.startsWith(body.commit)).toBe(true);
  });

  it("forbids caching so no edge can answer 'ok' on a dead deployment's behalf", async () => {
    const response = await GET();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
