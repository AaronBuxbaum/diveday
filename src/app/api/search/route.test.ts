import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { people, shops } from "@/db/schema";
import { seededShopContext } from "@/test/db";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
// Same reasoning as src/app/api/trips/[id]/manifest-events/route.test.ts: a
// bare mock avoids ever loading the real next-auth module outside Next's
// bundler.
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<Session | null>>() }));
// `requestLocale` reads `next/headers`' `headers()`, which only resolves
// inside a real Next request scope — absent here since the route is invoked
// directly. An empty header set negotiates down to the shop's default
// locale, same as a real request that sends no Accept-Language (see
// src/app/api/offline-manifests/upcoming/route.test.ts).
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<Session | null>>>;
};
const auth = authModule.auth;
const { GET } = await import("./route");

function searchRequest(query: string) {
  return new Request(`http://localhost/api/search?q=${encodeURIComponent(query)}`);
}

const staffSession = (shopId: string, roles: Session["user"]["roles"] = ["owner"]): Session => ({
  user: {
    personId: "staff-1",
    shopId,
    shopSlug: "blue-mantis",
    name: "Dana Reyes",
    roles,
  },
  expires: new Date(Date.now() + 60_000).toISOString(),
});

beforeEach(() => {
  vi.mocked(auth).mockReset();
  vi.mocked(getDb).mockReset();
});

describe("GET /api/search", () => {
  it("rejects an unauthenticated caller with 401, never data", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    const response = await GET(searchRequest("priya"));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).not.toHaveProperty("divers");
  });

  it("rejects a signed-in caller who isn't staff", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, []));
    const response = await GET(searchRequest("priya"));
    expect(response.status).toBe(401);
  });

  it("returns the caller's own shop's matches for a query in `q`", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id));

    const response = await GET(searchRequest("priya"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.divers.map((d: { fullName: string }) => d.fullName)).toContain("Priya Sharma");
  });

  it("never returns another shop's people, even when both have a same-named diver", async () => {
    const { db, shop } = await seededShopContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Second Shop", slug: "second-shop", timezone: "America/New_York" })
      .returning();
    if (!otherShop) throw new Error("insert failed");
    const [otherPriya] = await db
      .insert(people)
      .values({ shopId: otherShop.id, fullName: "Priya Sharma", email: "priya@second.example" })
      .returning();
    if (!otherPriya) throw new Error("insert failed");

    vi.mocked(getDb).mockResolvedValue(db);
    // Session is scoped to the seeded shop, not the newly-created one — the
    // route must never let a query parameter widen the search beyond the
    // session's own shopId, no matter what the caller sends in `q`.
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id));

    const response = await GET(searchRequest("priya"));
    const body = await response.json();
    expect(body.divers.map((d: { id: string }) => d.id)).not.toContain(otherPriya.id);
  });

  it("sets Cache-Control: private, no-store", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id));

    const response = await GET(searchRequest("priya"));
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("treats a missing `q` as an empty query rather than throwing", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id));

    const response = await GET(new Request("http://localhost/api/search"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ divers: [], trips: [], diveSites: [], courses: [], orders: [] });
  });
});
