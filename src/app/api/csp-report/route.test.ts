import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextHeadersStub } from "@/test/next-headers";
import { POST } from "./route";

/**
 * The report endpoint is public, unauthenticated, and writes to a paid log
 * stream — the same posture `api/vitals`'s own test file states. What is
 * different here (see `src/lib/csp-reports.ts` and its test) is that a
 * violation report is also a browser sitting on a page whose URL can itself
 * be a bearer token, so most of this file is about what gets there redacted
 * rather than dropped outright.
 */

vi.mock("next/headers", () => nextHeadersStub({ headers: { "x-forwarded-for": "203.0.113.7" } }));

function report(body: unknown, headers: HeadersInit = {}): Request {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("https://dive.day/api/csp-report", {
    method: "POST",
    headers,
    body: text,
  });
}

function loggedLines(): Record<string, unknown>[] {
  return vi
    .mocked(console.warn)
    .mock.calls.map((call) => JSON.parse(call[0] as string) as Record<string, unknown>)
    .filter((line) => line.event === "security.csp_violation");
}

describe("POST /api/csp-report", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("records a well-formed violation and answers 204", async () => {
    const response = await POST(
      report({
        "csp-report": {
          "document-uri": "https://dive.day/s/blue-mantis",
          "effective-directive": "connect-src",
          "blocked-uri": "https://tracker.example/collect",
          disposition: "report",
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(loggedLines()).toEqual([
      expect.objectContaining({
        event: "security.csp_violation",
        level: "warn",
        directive: "connect-src",
        blocked: "https://tracker.example",
        route: "/s/blue-mantis",
        disposition: "report",
      }),
    ]);
  });

  it("redacts a capability URL before it can reach the log group", async () => {
    // A hand-rolled POST bypasses browser-side redaction entirely — this is
    // the copy that actually protects the log group.
    await POST(
      report({
        "csp-report": {
          "document-uri": "https://dive.day/ready/aVeryRealBearerToken",
          "effective-directive": "script-src",
        },
      }),
    );

    const [line] = loggedLines();
    expect(line?.route).toBe("/ready/[token]");
    expect(JSON.stringify(line)).not.toContain("aVeryRealBearerToken");
  });

  it("logs each violation in a batched Reporting API body as its own line", async () => {
    await POST(
      report([
        {
          type: "csp-violation",
          body: { documentURL: "https://dive.day/", effectiveDirective: "img-src" },
        },
        {
          type: "csp-violation",
          body: { documentURL: "https://dive.day/", effectiveDirective: "font-src" },
        },
      ]),
    );

    expect(loggedLines().map((line) => line.directive)).toEqual(["img-src", "font-src"]);
  });

  it.each([
    ["a body that is not JSON", "not json at all"],
    ["an empty body", ""],
    ["a body neither wire format matches", JSON.stringify({ nonsense: true })],
    ["a batch with no csp-violation entries", JSON.stringify([{ type: "deprecation" }])],
  ])("answers 204 and records nothing for %s", async (_label, body) => {
    const response = await POST(report(body));

    expect(response.status).toBe(204);
    expect(loggedLines()).toEqual([]);
  });

  it("refuses a body whose stated Content-Length is already past the cap", async () => {
    // The header is checked before the body is ever read — this proves the
    // route refuses on the header alone by sending a body far too small to
    // trip the byte-length fallback on its own.
    const response = await POST(report("{}", { "content-length": "1000000" }));

    expect(response.status).toBe(204);
    expect(loggedLines()).toEqual([]);
  });

  it("refuses a body far larger than any real report", async () => {
    const response = await POST(
      report({
        "csp-report": {
          "effective-directive": "img-src",
          "blocked-uri": `https://evil.example/${"p".repeat(20_000)}`,
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(loggedLines()).toEqual([]);
  });

  it("logs at most the first violations in an oversized batch", async () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({
      type: "csp-violation",
      body: {
        documentURL: "https://dive.day/",
        effectiveDirective: i % 2 === 0 ? "img-src" : "font-src",
      },
    }));

    await POST(report(entries));

    expect(loggedLines().length).toBeLessThanOrEqual(20);
  });

  it("stops recording once the per-IP ceiling is spent", async () => {
    const send = () => POST(report({ "csp-report": { "effective-directive": "img-src" } }));

    // The bucket is `RATE_LIMITS.cspReport` (120/hour); a little past it is
    // enough to prove the endpoint stops writing rather than stops answering.
    for (let attempt = 0; attempt < 130; attempt += 1) {
      const response = await send();
      // Never a distinguishable answer — the endpoint always 204s.
      expect(response.status).toBe(204);
    }

    expect(loggedLines().length).toBeLessThanOrEqual(120);
    expect(loggedLines().length).toBeGreaterThan(0);
  });
});
