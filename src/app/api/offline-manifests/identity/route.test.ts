import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { shops } from "@/db/schema";
import { seededShopContext } from "@/test/db";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
// See the sync route's test for why `auth` is mocked bare instead of via
// importOriginal (ADR 20260719-msw-offline-sync-only).
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<Session | null>>() }));

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<Session | null>>>;
};
const auth = authModule.auth;
const { GET } = await import("./route");

const sessionFor = (
  shopId: string,
  roles: Session["user"]["roles"] = ["captain"],
  shopSlug = "blue-mantis",
): Session => ({
  user: { personId: "staff-1", shopId, shopSlug, name: "Dana Reyes", roles },
  expires: new Date(Date.now() + 60_000).toISOString(),
});

beforeEach(() => {
  vi.mocked(auth).mockReset();
  vi.mocked(getDb).mockReset();
});

describe("GET /api/offline-manifests/identity", () => {
  it("answers with the caller's own shop slug and nothing else", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(sessionFor(shop.id));

    const response = await GET();
    expect(response.status).toBe(200);
    // Exact equality, not a property check: this is the whole contract. A
    // future field added here ships to a shared boat tablet, which is what the
    // roster route already does wrong (review 20260802, action item 12).
    expect(await response.json()).toEqual({ shop: { slug: "blue-mantis" } });
  });

  it("carries no roster, no diver names, and no count that leaks how big the board is", async () => {
    // The seeded shop genuinely has trips departing inside the roster route's
    // 48-hour window and real divers on them (see the upcoming route's test),
    // so "nothing about them appears here" is an assertion with something to
    // catch rather than a tautology about an empty shop.
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(sessionFor(shop.id));

    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;

    // Two top-level keys would be one too many: a sibling `tripCount` is a
    // roster-size leak even with no names in it, and this is where that gets
    // caught.
    expect(Object.keys(body)).toEqual(["shop"]);
    expect(Object.keys(body.shop as Record<string, unknown>)).toEqual(["slug"]);
    const serialized = JSON.stringify(body);
    for (const term of ["payloads", "manifests", "divers", "crew", "summary", "trip", "blocker"]) {
      expect(serialized).not.toContain(term);
    }
  });

  it("cannot be coaxed into returning roster data by a query string", async () => {
    // The alternative shape considered for this fix was `?identityOnly=1` on
    // the roster route, where forgetting or dropping the flag silently returns
    // the whole board. A separate route cannot fail that way, and this proves
    // it: the handler takes no request at all, so there is no parameter to
    // widen. Called with every flag name that shape would have used.
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(sessionFor(shop.id));

    for (const query of ["?identityOnly=0", "?identityOnly=false", "?payloads=1", "?full=1"]) {
      const handler = GET as unknown as (request?: Request) => Promise<Response>;
      const response = await handler(
        new Request(`http://localhost/api/offline-manifests/identity${query}`),
      );
      expect(await response.json()).toEqual({ shop: { slug: "blue-mantis" } });
    }
  });

  it("rejects an unauthenticated caller with 401 and no shop", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).not.toHaveProperty("shop");
    // Never reached the database — the tenant question is answered from the
    // session or not at all.
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects a signed-in diver, who has a session but no offline-manifest access", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(sessionFor(shop.id, ["diver"]));

    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).not.toHaveProperty("shop");
  });

  it("rejects a session carrying no roles at all", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(sessionFor(shop.id, []));

    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("answers for the shop the session is scoped to, never the slug the session claims", async () => {
    // The adversarial case this route exists inside: a device signed in as one
    // shop must never be told it is another, because the offline shell deletes
    // every saved roster whose shop differs from this answer. A tampered or
    // stale `shopSlug` claim on the session must not reach the response — the
    // slug is read from the row `shopId` points at.
    const { db, shop } = await seededShopContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Reef Runners", slug: "reef-runners", timezone: "America/New_York" })
      .returning();
    if (!otherShop) throw new Error("insert failed");

    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(sessionFor(otherShop.id, ["captain"], "blue-mantis"));

    const response = await GET();
    expect(await response.json()).toEqual({ shop: { slug: "reef-runners" } });
    expect(otherShop.id).not.toBe(shop.id);
  });

  it("404s when the session's shop no longer exists, rather than guessing one", async () => {
    // A deleted shop must not resolve to some other tenant's slug: the shell
    // treats a non-OK response as "cannot establish the tenant" and purges
    // nothing, which is the safe direction.
    const { db } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(sessionFor("00000000-0000-4000-8000-000000000000"));

    const response = await GET();
    expect(response.status).toBe(404);
    expect(await response.json()).not.toHaveProperty("shop");
  });

  it("sets Cache-Control: private, no-store on every response, refusals included", async () => {
    // A cached identity answer on a shared boat tablet inverts the purge: the
    // next shop's browser is told it is the previous shop, so its own captain's
    // manifests get deleted and the previous shop's roster survives. Both
    // directions of the bug this route exists to prevent, at once.
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(sessionFor(shop.id));
    expect((await GET()).headers.get("Cache-Control")).toBe("private, no-store");

    vi.mocked(auth).mockResolvedValue(null);
    expect((await GET()).headers.get("Cache-Control")).toBe("private, no-store");

    vi.mocked(auth).mockResolvedValue(sessionFor("00000000-0000-4000-8000-000000000000"));
    expect((await GET()).headers.get("Cache-Control")).toBe("private, no-store");
  });
});
