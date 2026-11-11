import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffSession } from "@/test/staff-session";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/client")>()),
  getDb: vi.fn(async () => ({})),
}));
vi.mock("@/db/shops", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/shops")>()),
  getShopById: vi.fn(),
}));
vi.mock("@/db/executed-dives", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/executed-dives")>()),
  upsertExecutedDive: vi.fn(async () => ({ ok: true }) as const),
}));
vi.mock("../../../../../../features/session/rules", async () =>
  (await import("@/test/staff-session")).sessionMockOverStaffSession(),
);
const { requireStaffSession } = await import("../../../../../../features/session/rules");
const { getShopById } = await import("@/db/shops");
const { upsertExecutedDive } = await import("@/db/executed-dives");
const { saveExecutedDiveAction } = await import("./actions");
const SHOP = { id: "00000000-0000-4000-8000-000000000001", slug: "blue-mantis" };
const ctx = {
  shopSlug: SHOP.slug,
  tripId: "00000000-0000-4000-8000-0000000000aa",
  checkpoint: "after_dive_1",
} as const;
function form(value: string, unit?: string) {
  const data = new FormData();
  data.set("diveNumber", "1");
  data.set("actualSiteId", "");
  data.set("maxDepthMeters", value);
  if (unit !== undefined) data.set("depthUnit", unit);
  return data;
}
beforeEach(() => {
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({
      shopId: SHOP.id,
      shopSlug: SHOP.slug,
      personId: "00000000-0000-4000-8000-000000000002",
    }),
  );
  vi.mocked(getShopById).mockResolvedValue({
    ...SHOP,
    timezone: "UTC",
    depthUnit: "meters",
  } as Awaited<ReturnType<typeof getShopById>>);
  vi.mocked(upsertExecutedDive).mockClear();
});
describe("executed depth uses the submitted measurement unit", () => {
  it.each([
    ["feet", "meters", "60", 18.288],
    ["meters", "feet", "20.4", 20.4],
    ["feet", "feet", "60.5", 18.4404],
    ["meters", "meters", "20.4", 20.4],
  ] as const)(
    "keeps a %s form correct after preferences become %s",
    async (authored, current, value, meters) => {
      vi.mocked(getShopById).mockResolvedValue({
        ...SHOP,
        timezone: "UTC",
        depthUnit: current,
      } as Awaited<ReturnType<typeof getShopById>>);
      expect(await saveExecutedDiveAction(ctx, undefined, form(value, authored))).toEqual({
        status: "ok",
      });
      expect(upsertExecutedDive).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ maxDepthMeters: meters, shopId: SHOP.id, tripId: ctx.tripId }),
      );
    },
  );
  it.each([undefined, "yards"])("rejects absent or invalid units (%s)", async (unit) => {
    expect(await saveExecutedDiveAction(ctx, undefined, form("60", unit))).toEqual({
      status: "error",
      reason: "invalid",
    });
    expect(upsertExecutedDive).not.toHaveBeenCalled();
  });
  it.each([
    ["301", "meters"],
    ["1000", "feet"],
  ] as const)("checks the canonical bound for %s %s", async (value, unit) => {
    expect(await saveExecutedDiveAction(ctx, undefined, form(value, unit))).toEqual({
      status: "error",
      reason: "depth_out_of_range",
    });
    expect(upsertExecutedDive).not.toHaveBeenCalled();
  });
  it.each(["blank", "not-recorded"])("writes null for %s depth", async (kind) => {
    const data = form(kind === "blank" ? "" : "60", "feet");
    if (kind === "not-recorded") data.set("notRecorded", "depth");
    expect(await saveExecutedDiveAction(ctx, undefined, data)).toEqual({ status: "ok" });
    expect(upsertExecutedDive).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maxDepthMeters: null }),
    );
  });
});
