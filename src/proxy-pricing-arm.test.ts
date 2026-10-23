import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// The pricing arm the proxy assigns and passes on (ADR 20261022-pricing-ab-test),
// apart from `proxy.test.ts`, which is at its file-length baseline. Both stub
// the database away at the module boundary, and the auth cookie as a
// signed-in owner.
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

function request(url: string, headers?: Record<string, string>): NextRequest {
  return new NextRequest(`http://127.0.0.1${url}`, { headers });
}

async function run(req: NextRequest): Promise<Response> {
  const res = await proxy(req, {});
  if (!res) throw new Error("proxy returned no response");
  return res;
}

describe("the pricing arm (ADR 20261022-pricing-ab-test)", () => {
  const ARM_HEADER = "x-middleware-request-x-diveday-pricing-arm";

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("writes no cookie and passes no arm while the test is off", async () => {
    const res = await run(request("/pricing"));
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get(ARM_HEADER)).toBe("");
  });

  it("ignores an arm cookie, and a forged header, while the test is off", async () => {
    const res = await run(
      request("/pricing", {
        cookie: "dd_pricing=percent_of_volume",
        "x-diveday-pricing-arm": "percent_of_volume",
      }),
    );
    expect(res.headers.get(ARM_HEADER)).toBe("");
  });

  it("gives a new visitor an arm, on the cookie and on this request", async () => {
    vi.stubEnv("PRICING_TEST", "on");
    vi.stubEnv("PRICING_PERCENT_SPLIT", "100");
    const res = await run(request("/pricing"));
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("dd_pricing=percent_of_volume");
    expect(cookie).toContain("HttpOnly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(cookie).toContain("Max-Age=7776000");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get(ARM_HEADER)).toBe("percent_of_volume");
  });

  it("keeps the arm a returning visitor already holds, whatever the split says now", async () => {
    vi.stubEnv("PRICING_TEST", "on");
    vi.stubEnv("PRICING_PERCENT_SPLIT", "100");
    const res = await run(request("/", { cookie: "dd_pricing=flat_monthly" }));
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get(ARM_HEADER)).toBe("flat_monthly");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("replaces a cookie that names no arm, and overwrites a forged header", async () => {
    vi.stubEnv("PRICING_TEST", "on");
    vi.stubEnv("PRICING_PERCENT_SPLIT", "0");
    const res = await run(
      request("/get-set-up", {
        cookie: "dd_pricing=free_forever",
        "x-diveday-pricing-arm": "percent_of_volume",
      }),
    );
    expect(res.headers.get("set-cookie")).toContain("dd_pricing=flat_monthly");
    expect(res.headers.get(ARM_HEADER)).toBe("flat_monthly");
  });

  it("passes no arm off the marketing pages, test on or not", async () => {
    vi.stubEnv("PRICING_TEST", "on");
    const res = await run(
      request("/shop/blue-mantis/divers", { cookie: "dd_pricing=percent_of_volume" }),
    );
    expect(res.headers.get(ARM_HEADER)).toBe("");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
