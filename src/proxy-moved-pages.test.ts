import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

// Apart from `proxy.test.ts`, which is at its file-length baseline. The same
// stubs: no database, the auth cookie as a signed-in owner.
vi.mock("@/db/client", () => ({ getDb: async () => ({}) }));
vi.mock("./features/public-route-existence/store", () => ({
  rememberedPublicRouteLookup: async () => ({ exists: true, shopExists: true, hidden: false }),
}));
vi.mock("better-auth/cookies", () => ({
  getSessionCookie: () => "mock-session-token",
  getCookieCache: async () => ({
    session: { personId: "person-1", shopId: "shop-1", shopSlug: "blue-mantis", roles: ["owner"] },
  }),
}));

import { proxy } from "@/proxy";

function request(url: string): NextRequest {
  return new NextRequest(`http://127.0.0.1${url}`);
}

async function run(req: NextRequest): Promise<Response> {
  const res = await proxy(req, {});
  if (!res) throw new Error("proxy returned no response");
  return res;
}

/**
 * **The reader's own pages left Settings for `/me`** (issue #2739). Emails
 * already in inboxes link to `/settings/email`, so the old addresses 308 to the
 * new ones, query kept, and nothing else under `/settings` moves.
 */
describe("the reader's pages that moved out of Settings", () => {
  it("308s the old addresses to /me, keeping the query", async () => {
    for (const [from, to] of [
      ["/shop/blue-mantis/settings/email", "/shop/blue-mantis/me/email"],
      ["/shop/blue-mantis/settings/email/preview", "/shop/blue-mantis/me/email/preview"],
      ["/shop/blue-mantis/settings/security/", "/shop/blue-mantis/me/security"],
      [
        "/shop/blue-mantis/settings/security?notice=step-up-required",
        "/shop/blue-mantis/me/security?notice=step-up-required",
      ],
      ["/shop/another-shop/settings/calendar", "/shop/another-shop/me/calendar"],
    ] as const) {
      const res = await run(request(from));
      expect(res.status, from).toBe(308);
      const location = new URL(res.headers.get("location") ?? "", "http://x");
      expect(`${location.pathname}${location.search}`, from).toBe(to);
    }
  });

  it("leaves the rest of Settings alone", async () => {
    for (const path of [
      "/shop/blue-mantis/settings",
      "/shop/blue-mantis/settings/team",
      "/shop/blue-mantis/settings/email/extra",
      "/shop/blue-mantis/settings/calendar/extra",
    ]) {
      expect((await run(request(path))).status, path).not.toBe(308);
    }
  });
});
