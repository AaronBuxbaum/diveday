import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

// No database, as `proxy-staff-gate.test.ts`: the staff cookie is read from
// the request itself, so a diver's cookie beside it is really sent.
vi.mock("@/db/client", () => ({ getDb: async () => ({}) }));
vi.mock("./features/public-site/public-route-existence", () => ({
  rememberedPublicRouteLookup: async () => ({ exists: true, shopExists: true, hidden: false }),
}));
const STAFF_COOKIE = "better-auth.session_token";
vi.mock("better-auth/cookies", () => ({
  getSessionCookie: (req: NextRequest) => req.cookies.get(STAFF_COOKIE)?.value ?? null,
  getCookieCache: async (req: NextRequest) =>
    req.cookies.get(STAFF_COOKIE)
      ? {
          session: {
            personId: "person-1",
            shopId: "shop-1",
            shopSlug: "blue-mantis",
            roles: ["owner"],
          },
        }
      : null,
}));

import { DIVER_SESSION_COOKIE, diverSessionCookie } from "@/features/accounts/diver-sign-in";
import { proxy } from "@/proxy";

const DIVER = `${DIVER_SESSION_COOKIE}=${"d".repeat(43)}`;

async function run(path: string, cookie: string): Promise<Response> {
  const res = await proxy(new NextRequest(`http://127.0.0.1${path}`, { headers: { cookie } }), {});
  if (!res) throw new Error("proxy returned no response");
  return res;
}

/** ADR 20261125-diver-sign-in: a diver session is not a staff session, and leaves one alone. */
describe("a diver session at the staff gate", () => {
  it("opens no /shop/** page", async () => {
    const res = await run("/shop/blue-mantis/divers", DIVER);
    expect(new URL(res.headers.get("location") ?? "", "http://x").pathname).toBe("/sign-in");
  });

  it("leaves a staff session beside it working", async () => {
    const res = await run("/shop/blue-mantis/divers", `${DIVER}; ${STAFF_COOKIE}=staff`);
    expect(res.headers.get("location")).toBeNull();
  });

  it("is a cookie the browser sends to that shop's public pages only", () => {
    const cookie = diverSessionCookie("blue-mantis", "t");
    expect(cookie).toMatchObject({ path: "/s/blue-mantis", httpOnly: true, sameSite: "lax" });
    expect("/shop/blue-mantis/divers".startsWith(`${cookie.path}/`)).toBe(false);
  });
});
