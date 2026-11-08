import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// Pricing is configuration and no longer assigned by the proxy,
// apart from `proxy.test.ts`, which is at its file-length baseline. Both stub
// the database away at the module boundary, and the auth cookie as a
// signed-in owner.
vi.mock("@/db/client", () => ({ getDb: async () => ({}) }));
vi.mock("@/features/public-route-existence", () => ({
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

function request(url: string, headers?: Record<string, string>, method = "GET"): NextRequest {
  return new NextRequest(`http://127.0.0.1${url}`, { headers, method });
}

async function run(req: NextRequest): Promise<Response> {
  const res = await proxy(req, {});
  if (!res) throw new Error("proxy returned no response");
  return res;
}

describe("configured pricing needs no visitor assignment", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(["GET", "HEAD", "POST"])("writes no pricing cookie on %s", async (method) => {
    vi.stubEnv("PRICING_BASIS_POINTS", "300");
    const res = await run(request("/pricing", { cookie: "dd_pricing=flat_monthly" }, method));
    expect(res.headers.get("set-cookie") ?? "").not.toContain("dd_pricing");
    expect(res.headers.get("x-middleware-request-x-diveday-pricing-arm")).toBeNull();
  });
});
