import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function fakeDb(execute: () => Promise<unknown>) {
  return { execute: vi.fn(execute) };
}

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
  it("reports ok and the short commit SHA when the database answers", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", SHA);
    const db = fakeDb(async () => [{ "?column?": 1 }]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", commit: "0123456" });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it("waits for a connection so the probe is never prerendered at build time", async () => {
    vi.mocked(getDb).mockResolvedValue(fakeDb(async () => []) as never);
    await GET();
    expect(connection).toHaveBeenCalledTimes(1);
  });

  it("answers 503 when the database query throws, so a monitor sees a bad status code", async () => {
    vi.mocked(getDb).mockResolvedValue(
      fakeDb(async () => {
        throw new Error("connection to server at db.internal.example (10.0.0.4) failed");
      }) as never,
    );

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "error", commit: "unknown" });
  });

  it("answers 503 when the database is unreachable at connect time", async () => {
    vi.mocked(getDb).mockRejectedValue(new Error("ECONNREFUSED 10.0.0.4:5432"));

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "error", commit: "unknown" });
  });

  it("never leaks the driver's error text, hostnames or env values in the body", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://app:hunter2@db.internal.example:5432/diveday");
    vi.mocked(getDb).mockRejectedValue(
      new Error("connect ECONNREFUSED db.internal.example:5432 (user=app password=hunter2)"),
    );

    const body = await (await GET()).text();

    expect(body).not.toContain("db.internal.example");
    expect(body).not.toContain("hunter2");
    expect(body).not.toContain("ECONNREFUSED");
    expect(body).not.toContain("5432");
    // Exactly two fields, so a future edit can't quietly widen the disclosure.
    expect(Object.keys(JSON.parse(body))).toEqual(["status", "commit"]);
  });

  it("discloses only the short SHA, never the full commit", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", SHA);
    vi.mocked(getDb).mockResolvedValue(fakeDb(async () => []) as never);

    const body = (await (await GET()).json()) as { commit: string };

    expect(body.commit).toHaveLength(7);
    expect(SHA.startsWith(body.commit)).toBe(true);
  });

  it("forbids caching so no edge can answer 'ok' on a dead deployment's behalf", async () => {
    vi.mocked(getDb).mockResolvedValue(fakeDb(async () => []) as never);
    const response = await GET();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
