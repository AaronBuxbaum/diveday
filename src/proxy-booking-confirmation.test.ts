import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

// The booking confirmation's cache header (issue #2711), apart from
// `proxy.test.ts`, which is at its file-length baseline. The confirmation
// carries a confirm token in `?booking=` and shows the diver's readiness link,
// so no shared cache may keep it. The database is stubbed away at the module
// boundary; every route exists.
vi.mock("@/db/client", () => ({ getDb: async () => ({}) }));
vi.mock("@/db/public-route-existence", () => ({
  rememberedPublicRouteLookup: async () => ({ exists: true, shopExists: true, hidden: false }),
}));

import { proxy } from "@/proxy";

const TRIP_ID = "11111111-2222-4333-8444-555555555555";

async function run(url: string): Promise<Response> {
  const res = await proxy(new NextRequest(`http://127.0.0.1${url}`), {});
  if (!res) throw new Error("proxy returned no response");
  return res;
}

describe("the booking confirmation (issue #2711)", () => {
  it("is private and never stored wherever ?booking= names a confirm token", async () => {
    for (const url of [
      `/s/blue-mantis/embed/trip/${TRIP_ID}?booking=c1.AAAAAAAAAAAAAAAAAAAAAA.x`,
      `/s/blue-mantis/trips/${TRIP_ID}?booking=anything`,
    ]) {
      const res = await run(url);
      expect(res.headers.get("cache-control"), url).toBe("private, no-store");
    }
  });

  it("leaves a trip page without one alone", async () => {
    const res = await run(`/s/blue-mantis/embed/trip/${TRIP_ID}`);
    expect(res.headers.get("cache-control")).toBeNull();
  });
});
