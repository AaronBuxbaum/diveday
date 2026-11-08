import { beforeEach, describe, expect, it, vi } from "vitest";

const recapPageStateCached = vi.fn();
const checkRateLimit = vi.fn();

vi.mock("../../../../../features/recap/recap-cached.store", () => ({
  recapPageStateCached: (...args: unknown[]) => recapPageStateCached(...args),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimit(...args),
  rateLimitKey: (...parts: string[]) => parts.join(":"),
  RATE_LIMITS: { capabilityAction: { limit: 60, windowSeconds: 3600 } },
}));
vi.mock("@/lib/request-ip", () => ({ clientIp: async () => "203.0.113.9" }));
vi.mock("@/db/client", () => ({ getDb: async () => ({}) }));
vi.mock("@/db/recap-links", () => ({
  openRecapLink: async (_db: unknown, token: string) => (token === "good" ? "booking-1" : null),
}));

import { GET } from "./route";

const call = (token: string, query = "format=csv") =>
  GET(new Request(`https://dive.day/recap/${token}/log?${query}`), {
    params: Promise.resolve({ token }),
  });

const recap = {
  kind: "recap",
  data: {
    shop: { name: "Blue Mantis", timezone: "America/Cancun" },
    trip: {
      title: "Two-Tank Reef",
      startsAt: new Date("2026-10-03T13:00:00Z"),
      waterTemperatureC: 28,
      visibilityMeters: 20,
      surfaceConditions: null,
      id: "trip-secret",
    },
    sites: [{ name: "Palancar" }],
    diveRecord: null,
  },
};

beforeEach(() => {
  recapPageStateCached.mockReset();
  checkRateLimit.mockReset();
  checkRateLimit.mockResolvedValue({ allowed: true });
});

describe("the recap's log entry file", () => {
  it("hands over the CSV as an attachment, with nothing that names the link", async () => {
    recapPageStateCached.mockResolvedValue(recap);
    const response = await call("good");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="two-tank-reef-2026-10-03.csv"; filename*=UTF-8''two-tank-reef-2026-10-03.csv`,
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.text();
    expect(body).toContain(
      "2026-10-03,08:00,America/Cancun,Blue Mantis,Two-Tank Reef,Palancar,28,20,",
    );
    expect(body).not.toContain("good");
    expect(body).not.toContain("trip-secret");
  });

  it("serves a non-Latin trip title with an ASCII fallback and a UTF-8 filename* (L1)", async () => {
    recapPageStateCached.mockResolvedValue({
      ...recap,
      data: { ...recap.data, trip: { ...recap.data.trip, title: "沈船ダイブ" } },
    });
    const response = await call("good");
    expect(response.status).toBe(200);
    const disposition = response.headers.get("Content-Disposition") ?? "";
    expect(disposition).toMatch(/^[\x20-\x7e]+$/);
    expect(disposition).toContain('filename="dive-2026-10-03.csv"');
    expect(disposition).toContain("filename*=UTF-8''");
  });

  it("hands over UDDF the same way", async () => {
    recapPageStateCached.mockResolvedValue(recap);
    const response = await call("good", "format=uddf");
    expect(response.headers.get("Content-Type")).toContain("xml");
    expect(await response.text()).toContain("<uddf version=");
  });

  it("answers one 404 for a forged token, an unopened recap and an unknown format", async () => {
    recapPageStateCached.mockResolvedValue({ kind: "waiting" });
    expect((await call("forged")).status).toBe(404);
    expect((await call("good")).status).toBe(404);
    recapPageStateCached.mockResolvedValue(recap);
    expect((await call("good", "format=pdf")).status).toBe(404);
    expect((await call("good", "")).status).toBe(404);
  });

  it("is throttled before the token is looked at", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false });
    const response = await call("good");
    expect(response.status).toBe(429);
    expect(recapPageStateCached).not.toHaveBeenCalled();
  });
});
