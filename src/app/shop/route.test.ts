// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **`/shop` is where the installed app opens** (`start_url` in
 * src/app/manifest.ts; issue #2342). The edge proxy sends a staffer on to their
 * shop when its cookie cache can say which shop that is. When it cannot (the
 * cache is cold, which it is after five idle minutes) the request reaches this
 * handler, which must decide from the session itself, read live, and never from
 * anything the request carries.
 */

vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/db/shops", () => ({ getShopById: vi.fn() }));

const { requireStaffSession } = await import("@/lib/session");
const { getShopById } = await import("@/db/shops");
const { GET } = await import("./route");

const STAFFER = { user: { personId: "person-1", shopId: "shop-1", shopSlug: "stale-slug" } };

beforeEach(() => {
  vi.mocked(requireStaffSession).mockReset();
  vi.mocked(getShopById).mockReset();
});

describe("GET /shop", () => {
  it("sends a staffer to their own shop, by the shop row's slug", async () => {
    vi.mocked(requireStaffSession).mockResolvedValue(STAFFER as never);
    vi.mocked(getShopById).mockResolvedValue({ id: "shop-1", slug: "reef-life" } as never);

    const response = await GET();

    // Temporary: where `/shop` leads depends on who is asking.
    expect(response.status).toBe(307);
    // Relative, so the hop keeps the host the cookie was set on.
    expect(response.headers.get("Location")).toBe("/shop/reef-life");
    // Per person: no shared cache may hand one staffer's shop to the next.
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    // The session's shop, never a slug the cookie carried.
    expect(getShopById).toHaveBeenCalledWith({}, "shop-1");
  });

  it("escapes the slug it builds the Location from", async () => {
    vi.mocked(requireStaffSession).mockResolvedValue(STAFFER as never);
    vi.mocked(getShopById).mockResolvedValue({ id: "shop-1", slug: "a?b#c" } as never);

    const response = await GET();

    expect(response.headers.get("Location")).toBe("/shop/a%3Fb%23c");
  });

  it("leaves anyone who is not live staff to the session gate's own refusal", async () => {
    const refusal = new Error("NEXT_REDIRECT /sign-in");
    vi.mocked(requireStaffSession).mockRejectedValue(refusal);

    await expect(GET()).rejects.toBe(refusal);
    expect(getShopById).not.toHaveBeenCalled();
  });

  it("answers not found when the session's shop row is gone", async () => {
    vi.mocked(requireStaffSession).mockResolvedValue(STAFFER as never);
    vi.mocked(getShopById).mockResolvedValue(undefined as never);

    await expect(GET()).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });
});
