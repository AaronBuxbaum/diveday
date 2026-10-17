import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiveDaySession } from "@/lib/auth";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId, staffSession } from "@/test/staff-session";

/**
 * **The report's file is the session's shop's, under its own slug** (the
 * w4 security review): `/shop/<another-slug>/reports/download` is a 404,
 * never this shop's numbers under that shop's name.
 */
const ctx = fileScopedShopContext();

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn<() => Promise<DiveDaySession>>() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = (await import("@/lib/session")) as unknown as {
  requireStaffSession: ReturnType<typeof vi.fn<() => Promise<DiveDaySession>>>;
};
const { GET } = await import("./route");

const download = (slug: string) =>
  GET(new Request(`http://localhost/shop/${slug}/reports/download?year=2026`), {
    params: Promise.resolve({ shopSlug: slug }),
  });

beforeEach(async () => {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const personId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  requireStaffSession.mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId, roles: ["owner"] }),
  );
});

describe("GET /shop/[shopSlug]/reports/download", () => {
  it("serves the owner's own shop under its own slug", async () => {
    expect((await download(ctx.shop.slug)).status).toBe(200);
  });

  it("is a 404 under any other shop's slug", async () => {
    expect((await download("another-shop")).status).toBe(404);
  });
});
