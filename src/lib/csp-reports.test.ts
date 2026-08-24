import { describe, expect, it } from "vitest";
import { parseCspReports } from "./csp-reports";

describe("parsing a violation report", () => {
  it("reads the classic report-uri body", () => {
    expect(
      parseCspReports({
        "csp-report": {
          "document-uri": "https://dive.day/s/blue-mantis?month=2026-08",
          "effective-directive": "connect-src",
          "blocked-uri": "https://tracker.example/collect?id=7",
          disposition: "report",
        },
      }),
    ).toEqual([
      {
        directive: "connect-src",
        blocked: "https://tracker.example",
        route: "/s/blue-mantis",
        disposition: "report",
      },
    ]);
  });

  it("reads the Reporting API's batched body, and only its CSP entries", () => {
    expect(
      parseCspReports([
        {
          type: "csp-violation",
          body: {
            documentURL: "https://dive.day/shop/blue-mantis/orders",
            effectiveDirective: "img-src",
            blockedURL: "https://cdn.example/pixel.gif",
            disposition: "enforce",
          },
        },
        // A Reporting API endpoint receives deprecation and intervention
        // reports through the same group unless they are filtered out.
        { type: "deprecation", body: { documentURL: "https://dive.day/" } },
      ]),
    ).toEqual([
      {
        directive: "img-src",
        blocked: "https://cdn.example",
        route: "/shop/blue-mantis/orders",
        disposition: "enforce",
      },
    ]);
  });

  it("falls back to violated-directive when the effective one is absent", () => {
    const [violation] = parseCspReports({
      "csp-report": { "violated-directive": "script-src 'self'" },
    });
    expect(violation?.directive).toBe("script-src 'self'");
  });

  it("keeps the keyword a browser sends in place of a URL", () => {
    // `inline`, `eval`, `data` and `blob` arrive as bare words rather than
    // URLs, and they are the most informative values this endpoint receives.
    const [violation] = parseCspReports({
      "csp-report": { "effective-directive": "script-src", "blocked-uri": "inline" },
    });
    expect(violation?.blocked).toBe("inline");
  });

  it("answers nothing rather than throwing on a body it does not recognise", () => {
    // The route answers 204 to everything, so a stranger's malformed body must
    // be a non-event rather than an error path.
    expect(parseCspReports({ nonsense: true })).toEqual([]);
    expect(parseCspReports(null)).toEqual([]);
    expect(parseCspReports("a string")).toEqual([]);
    expect(parseCspReports([{ type: "csp-violation" }])).toEqual([]);
  });

  describe("what must never reach a log line", () => {
    it("redacts a capability URL down to its route", () => {
      // A waiver, ready, recap or claim URL's path segment IS the credential
      // (docs/engineering/capability-telemetry-runbook.md), and a violation
      // report is written by a browser sitting on exactly those pages.
      const [violation] = parseCspReports({
        "csp-report": {
          "document-uri": "https://dive.day/ready/f3c1a9b7-secret-token",
          "effective-directive": "frame-src",
          "blocked-uri": "https://maps.google.com/maps?q=Molasses+Reef",
        },
      });
      expect(violation?.route).toBe("/ready/[token]");
      expect(violation?.route).not.toContain("secret-token");
    });

    it("reduces a blocked URL to its origin", () => {
      // A blocked URL carries a query string, and this endpoint has no reason
      // to reconstruct one.
      const [violation] = parseCspReports({
        "csp-report": {
          "effective-directive": "img-src",
          "blocked-uri": "https://evil.example/p?email=diver%40example.com",
        },
      });
      expect(violation?.blocked).toBe("https://evil.example");
    });

    it("drops script-sample, which is a slice of the rendered page", () => {
      // The one field that would carry a diver's name into a log group: on
      // this app the offending inline script is usually the flight payload.
      const [violation] = parseCspReports({
        "csp-report": {
          "effective-directive": "script-src",
          "blocked-uri": "inline",
          "script-sample": 'self.__next_f.push([1,"Adaeze Nwosu',
        },
      });
      expect(JSON.stringify(violation)).not.toContain("Adaeze");
    });

    it("bounds every field so one caller cannot write a wall of text", () => {
      const [violation] = parseCspReports({
        "csp-report": {
          "document-uri": `https://dive.day/${"a".repeat(500)}`,
          "effective-directive": "x".repeat(500),
          "blocked-uri": "y".repeat(500),
          disposition: "z".repeat(500),
        },
      });
      expect(violation?.route.length).toBeLessThanOrEqual(123);
      expect(violation?.directive.length).toBeLessThanOrEqual(43);
      expect(violation?.blocked.length).toBeLessThanOrEqual(27);
      expect(violation?.disposition.length).toBeLessThanOrEqual(19);
    });
  });
});
