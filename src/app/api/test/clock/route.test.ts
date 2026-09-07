import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { GET, POST } = await import("./route");

const secret = "e2e-test-secret";

function clockRequest(method: "GET" | "POST", body?: unknown, authorization?: string) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request("http://localhost/api/test/clock", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const authorized = `Bearer ${secret}`;

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("DIVEDAY_E2E_SECRET", secret);
  vi.stubEnv("DIVEDAY_CLOCK", "2026-07-21T10:00:00.000Z");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/api/test/clock — auth gate", () => {
  it("404s without the bearer token, on both verbs", async () => {
    expect((await GET(clockRequest("GET"))).status).toBe(404);
    expect((await POST(clockRequest("POST", { now: "2026-07-21T11:00:00Z" }))).status).toBe(404);
    // The refusal left the clock where it was.
    expect(process.env.DIVEDAY_CLOCK).toBe("2026-07-21T10:00:00.000Z");
  });

  it("404s with the wrong bearer token", async () => {
    const response = await POST(
      clockRequest("POST", { now: "2026-07-21T11:00:00Z" }, "Bearer wrong-secret"),
    );
    expect(response.status).toBe(404);
    expect(process.env.DIVEDAY_CLOCK).toBe("2026-07-21T10:00:00.000Z");
  });

  it("404s whenever a real database is configured, whatever the token", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://real");
    const response = await POST(clockRequest("POST", { now: "2026-07-21T11:00:00Z" }, authorized));
    expect(response.status).toBe(404);
  });
});

describe("/api/test/clock — moving the frozen clock", () => {
  it("reads the frozen instant back", async () => {
    const response = await GET(clockRequest("GET", undefined, authorized));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ now: "2026-07-21T10:00:00.000Z" });
  });

  it("advances the clock and reports the new instant", async () => {
    const response = await POST(clockRequest("POST", { now: "2026-07-21T15:00:00Z" }, authorized));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ now: "2026-07-21T15:00:00.000Z" });
    expect(process.env.DIVEDAY_CLOCK).toBe("2026-07-21T15:00:00.000Z");
  });

  it("refuses a step backwards", async () => {
    const response = await POST(clockRequest("POST", { now: "2026-07-21T09:00:00Z" }, authorized));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "clock_would_move_backwards" });
    expect(process.env.DIVEDAY_CLOCK).toBe("2026-07-21T10:00:00.000Z");
  });

  it("refuses a body that is not an instant", async () => {
    for (const body of [{ now: "yesterday" }, { now: 42 }, {}, undefined]) {
      const response = await POST(clockRequest("POST", body, authorized));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_body" });
    }
    expect(process.env.DIVEDAY_CLOCK).toBe("2026-07-21T10:00:00.000Z");
  });
});
