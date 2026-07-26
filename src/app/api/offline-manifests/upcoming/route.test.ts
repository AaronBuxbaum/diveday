import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { seededTestDb } from "@/test/db";

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

async function seededContext() {
  const db: AppDb = await seededTestDb();
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("demo shop missing");
  return { db, shop };
}

const staffSession = (shopId: string): Session => ({
  user: {
    personId: "staff-1",
    shopId,
    shopSlug: "blue-mantis",
    name: "Dana Reyes",
    roles: ["owner"],
  },
  expires: new Date(Date.now() + 60_000).toISOString(),
});

beforeEach(() => {
  vi.mocked(auth).mockReset();
  vi.mocked(getDb).mockReset();
});

describe("GET /api/offline-manifests/upcoming", () => {
  it("rejects an unauthenticated caller", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("rejects a non-staff caller even with a valid session shape", async () => {
    const { db, shop } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue({
      user: { personId: "diver-1", shopId: shop.id, shopSlug: "blue-mantis", roles: ["diver"] },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } as Session);

    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("returns trips departing within the 48-hour window and excludes trips beyond it", async () => {
    const { db, shop } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id));

    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      payloads: Array<{ manifests: Array<{ trip: { title: string } }> }>;
    };
    const titles = body.payloads.map((payload) => payload.manifests[0]?.trip.title);

    // Sails today (within the frozen clock's 5-hour lookahead) — well inside 48h.
    expect(titles).toContain("Two-Tank Reef — Molasses & French");
    // Seeded 2 days out at 23:30 UTC, past the 48-hour cutoff from the frozen
    // 13:30 UTC "now" (src/test/frozen-clock.ts) — must not appear.
    expect(titles).not.toContain("Night Dive — City of Washington");
    // Seeded 5+ days out — far outside the window.
    expect(titles).not.toContain("Wreck Trip — Spiegel Grove");
  });

  it("never returns another shop's trips", async () => {
    const { db, shop } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id));

    const response = await GET();
    const body = (await response.json()) as {
      payloads: Array<{ shop: { slug: string } }>;
    };
    for (const payload of body.payloads) {
      expect(payload.shop.slug).toBe("blue-mantis");
    }
  });
});
