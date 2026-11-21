import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

// Apart from `proxy.test.ts`, which is at its file-length baseline: no
// database, and the cookie the test sets.
vi.mock("@/db/client", () => ({ getDb: async () => ({}) }));
vi.mock("./features/public-site/public-route-existence", () => ({
  rememberedPublicRouteLookup: async () => ({ exists: true, shopExists: true, hidden: false }),
}));
const cookie = vi.hoisted(() => ({ roles: null as string[] | null }));
vi.mock("better-auth/cookies", () => ({
  getSessionCookie: () => (cookie.roles ? "mock-session-token" : null),
  getCookieCache: async () =>
    cookie.roles
      ? {
          session: {
            personId: "person-1",
            shopId: "shop-1",
            shopSlug: "blue-mantis",
            roles: cookie.roles,
          },
        }
      : null,
}));

import { proxy } from "@/proxy";

async function run(path: string, roles: string[] | null): Promise<Response> {
  cookie.roles = roles;
  const res = await proxy(new NextRequest(`http://127.0.0.1${path}`), {});
  if (!res) throw new Error("proxy returned no response");
  return res;
}

/** The staff gate is the `/shop` namespace, not every path that starts with those letters. */
describe("the staff gate's prefix", () => {
  it("sends a signed-out visitor to sign in from /shop and everything under it", async () => {
    for (const path of ["/shop", "/shop/", "/shop/blue-mantis/divers"]) {
      const res = await run(path, null);
      expect(res.status, path).toBe(307);
      expect(new URL(res.headers.get("location") ?? "", "http://x").pathname, path).toBe(
        "/sign-in",
      );
    }
  });

  it("leaves a sibling path that only starts with the same letters to its own rules", async () => {
    for (const path of ["/shopping", "/shop-notes/blue-mantis", "/shopfront"]) {
      const res = await run(path, null);
      expect(res.headers.get("location"), path).toBeNull();
      const diver = await run(path, ["diver"]);
      expect(diver.headers.get("location"), path).toBeNull();
    }
  });

  it("still turns a signed-in diver away from the staff pages", async () => {
    const res = await run("/shop/blue-mantis/divers", ["diver"]);
    expect(new URL(res.headers.get("location") ?? "", "http://x").pathname).toBe("/");
  });
});
