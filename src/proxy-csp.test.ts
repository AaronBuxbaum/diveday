import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

// The CSP header the proxy sets, apart from `proxy.test.ts`, which is about
// routing and is at its file-length baseline. Both stub the database away at
// the module boundary, and the auth cookie as a signed-in owner.
vi.mock("@/db/client", () => ({ getDb: async () => ({}) }));
vi.mock("@/db/public-route-existence", () => ({
  rememberedPublicRouteLookup: async () => ({ exists: true, shopExists: true, hidden: false }),
}));
vi.mock("better-auth/cookies", () => ({
  getSessionCookie: () => "mock-session-token",
  getCookieCache: async () => ({
    session: {
      personId: "person-1",
      shopId: "shop-1",
      shopSlug: "blue-mantis",
      roles: ["owner"],
    },
  }),
}));

import { proxy } from "@/proxy";

async function run(url: string): Promise<Response> {
  const res = await proxy(new NextRequest(`http://127.0.0.1${url}`), {});
  if (!res) throw new Error("proxy returned no response");
  return res;
}

describe("proxy CSP handling", () => {
  it("enforces the whole policy and sends no report-only header", async () => {
    const res = await run("/shop/blue-mantis/divers");
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'none'");
    // Breakage stays audible: an enforced block still reports.
    expect(csp).toContain("report-uri /api/csp-report");
    expect(res.headers.get("Reporting-Endpoints")).toBe('csp="/api/csp-report"');
    expect(res.headers.get("Content-Security-Policy-Report-Only")).toBeNull();
  });

  it("allows unsafe-eval in the enforced policy during e2e runs", async () => {
    vi.stubEnv("DIVEDAY_E2E", "1");
    vi.stubEnv("NODE_ENV", "production");
    const res = await run("/shop/blue-mantis/divers");
    expect(res.headers.get("Content-Security-Policy")).toContain("'unsafe-eval'");
    vi.unstubAllEnvs();
  });

  it("keeps unsafe-eval out of the enforced policy in production when not in e2e", async () => {
    vi.stubEnv("DIVEDAY_E2E", "");
    vi.stubEnv("NODE_ENV", "production");
    const res = await run("/shop/blue-mantis/divers");
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("script-src");
    expect(csp).not.toContain("'unsafe-eval'");
    vi.unstubAllEnvs();
  });
});
