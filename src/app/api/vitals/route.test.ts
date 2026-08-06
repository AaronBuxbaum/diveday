import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

/**
 * The beacon endpoint is public, unauthenticated, and writes to a paid log
 * stream. Everything here is about what it refuses.
 */

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
}));

function beacon(body: unknown): Request {
  return new Request("https://dive.day/api/vitals", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function loggedLines(): Record<string, unknown>[] {
  return vi
    .mocked(console.log)
    .mock.calls.map((call) => JSON.parse(call[0] as string) as Record<string, unknown>)
    .filter((line) => line.event === "web_vital.reported");
}

describe("POST /api/vitals", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("records a well-formed report and answers 204", async () => {
    const response = await POST(
      beacon({
        url: "/s/blue-mantis/trips/42",
        navigationType: "navigate",
        metrics: [
          { name: "LCP", value: 1_900 },
          { name: "CLS", value: 0.03 },
        ],
      }),
    );

    expect(response.status).toBe(204);
    expect(loggedLines()).toEqual([
      expect.objectContaining({
        event: "web_vital.reported",
        level: "info",
        route: "/s/blue-mantis/trips/42",
        lcp: 1_900,
        lcpRating: "good",
        cls: 0.03,
        clsRating: "good",
      }),
    ]);
  });

  it("redacts a capability URL before it can reach the log group", async () => {
    // The browser redacts too, but this is the copy that counts: a hand-rolled
    // POST bypasses the client entirely.
    await POST(
      beacon({
        url: "/waivers/aVeryRealBearerToken",
        metrics: [{ name: "LCP", value: 1_000 }],
      }),
    );

    const [line] = loggedLines();
    expect(line?.route).toBe("/waivers/[token]");
    expect(JSON.stringify(line)).not.toContain("aVeryRealBearerToken");
  });

  it("reduces an absolute URL to a path, so the log group cannot be written with someone else's", async () => {
    await POST(
      beacon({
        url: "https://evil.example/phish",
        metrics: [{ name: "LCP", value: 1_000 }],
      }),
    );

    const [line] = loggedLines();
    expect(line?.route).toBe("/phish");
    expect(JSON.stringify(line)).not.toContain("evil.example");
  });

  it("refuses a navigation type outside the Navigation Timing set", async () => {
    // Free-form here would be an anonymous caller choosing the cardinality of a
    // field the dashboard groups on.
    const response = await POST(
      beacon({
        url: "/x",
        navigationType: "'; drop table --",
        metrics: [{ name: "LCP", value: 10 }],
      }),
    );

    expect(response.status).toBe(204);
    expect(loggedLines()).toEqual([]);
  });

  it("redacts a capability token travelling as a query parameter", async () => {
    await POST(
      beacon({
        url: "/s/blue-mantis/trips/42?booking=aVeryRealBearerToken",
        metrics: [{ name: "TTFB", value: 120 }],
      }),
    );

    expect(JSON.stringify(loggedLines())).not.toContain("aVeryRealBearerToken");
  });

  it.each([
    ["a body that is not JSON", "not json at all"],
    ["an empty body", ""],
    ["a body with no metrics", JSON.stringify({ url: "/x", metrics: [] })],
    [
      "a metric name it does not publish",
      JSON.stringify({ url: "/x", metrics: [{ name: "XYZ", value: 1 }] }),
    ],
    [
      "a value large enough to move a p75 on its own",
      JSON.stringify({ url: "/x", metrics: [{ name: "LCP", value: 10 ** 12 }] }),
    ],
    ["a missing url", JSON.stringify({ metrics: [{ name: "LCP", value: 10 }] })],
  ])("answers 204 and records nothing for %s", async (_label, body) => {
    const response = await POST(beacon(body));

    expect(response.status).toBe(204);
    expect(loggedLines()).toEqual([]);
  });

  it("refuses a body far larger than any real report", async () => {
    const response = await POST(
      beacon({ url: `/x?pad=${"p".repeat(20_000)}`, metrics: [{ name: "LCP", value: 10 }] }),
    );

    expect(response.status).toBe(204);
    expect(loggedLines()).toEqual([]);
  });

  it("stops recording once the per-IP ceiling is spent", async () => {
    const report = () =>
      POST(beacon({ url: "/s/blue-mantis", metrics: [{ name: "LCP", value: 10 }] }));

    // The bucket is `RATE_LIMITS.webVitalsBeacon` (300/hour); a little past it
    // is enough to prove the endpoint stops writing rather than stops answering.
    for (let attempt = 0; attempt < 320; attempt += 1) {
      const response = await report();
      // Never a distinguishable answer — a beacon cannot read a response, and a
      // 429 here would only tell an abuser where the ceiling is.
      expect(response.status).toBe(204);
    }

    expect(loggedLines().length).toBeLessThanOrEqual(301);
    expect(loggedLines().length).toBeGreaterThan(0);
  });
});
