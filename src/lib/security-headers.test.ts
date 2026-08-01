import { describe, expect, it } from "vitest";
import { securityHeaderRules } from "./security-headers";

describe("securityHeaderRules (specialist-optimization-audit-20260731.md §5)", () => {
  it("applies the baseline set to every route", () => {
    const rules = securityHeaderRules();
    const catchAll = rules.find((rule) => rule.source === "/:path*");
    expect(catchAll).toBeDefined();
    const keys = catchAll?.headers.map((h) => h.key).sort();
    expect(keys).toEqual([
      "Permissions-Policy",
      "Referrer-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
    ]);
    expect(catchAll?.headers.find((h) => h.key === "Strict-Transport-Security")?.value).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(catchAll?.headers.find((h) => h.key === "X-Content-Type-Options")?.value).toBe(
      "nosniff",
    );
    expect(catchAll?.headers.find((h) => h.key === "Referrer-Policy")?.value).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it("tightens Referrer-Policy to no-referrer only on bearer-token routes", () => {
    const rules = securityHeaderRules();
    const tokenSources = [
      "/waivers/:token",
      "/ready/:token",
      "/recap/:token",
      "/verify/:token",
      "/reset-password/:token",
      "/invite/:token",
      "/unsubscribe/:token",
      "/calendar/:token",
    ];
    for (const source of tokenSources) {
      const rule = rules.find((r) => r.source === source);
      expect(rule, `expected a header rule for ${source}`).toBeDefined();
      expect(rule?.headers).toEqual([{ key: "Referrer-Policy", value: "no-referrer" }]);
    }
    // Nothing outside the catch-all and the token routes above.
    expect(rules).toHaveLength(1 + tokenSources.length);
  });
});
