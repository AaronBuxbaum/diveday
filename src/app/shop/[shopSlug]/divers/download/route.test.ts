import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/db/divers", () => ({
  isDiverFilter: (value: string | undefined) =>
    ["all", "diving_today", "needs_attention", "missing_contact", "not_back", "removed"].includes(
      value ?? "",
    ),
  isDiverSort: (value: string | undefined) => ["name", "last_dived"].includes(value ?? ""),
  listDiversForExport: vi.fn(),
}));
vi.mock("@/db/export", () => ({ canPersonExportShopData: vi.fn(async () => true) }));
vi.mock("@/db/shops", () => ({ getShopById: vi.fn() }));
vi.mock("@/lib/security-step-up", () => ({
  hasRequiredStepUp: vi.fn(async () => true),
  stepUpChallengeUrl: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));

const { getDb } = await import("@/db/client");
const { listDiversForExport } = await import("@/db/divers");
const { canPersonExportShopData } = await import("@/db/export");
const { getShopById } = await import("@/db/shops");
const { hasRequiredStepUp, stepUpChallengeUrl } = await import("@/lib/security-step-up");
const { requireStaffSession } = await import("@/lib/session");
const { GET } = await import("./route");

const shop = { id: "shop-id", slug: "reef-shop", timezone: "UTC" };

describe("GET the filtered diver roster CSV", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns no CSV and redirects to the localized roster notice when over 5,000", async () => {
    vi.mocked(getDb).mockResolvedValue({} as never);
    vi.mocked(requireStaffSession).mockResolvedValue({
      user: { shopId: shop.id, personId: "manager-id" },
    } as never);
    vi.mocked(getShopById).mockResolvedValue(shop as never);
    vi.mocked(listDiversForExport).mockResolvedValue({ exceededLimit: true, rows: [] });

    const response = await GET(
      new Request(
        "https://diveday.test/shop/reef-shop/divers/download?q=Reyes&filter=not_back&sort=last_dived",
      ),
      { params: Promise.resolve({ shopSlug: shop.slug }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("Content-Type")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(new URL(response.headers.get("Location") ?? "https://invalid.test").pathname).toBe(
      "/shop/reef-shop/divers",
    );
    expect(
      new URL(response.headers.get("Location") ?? "https://invalid.test").searchParams,
    ).toEqual(
      new URLSearchParams("q=Reyes&filter=not_back&sort=last_dived&notice=download-too-large"),
    );
    expect(listDiversForExport).toHaveBeenCalledWith(
      expect.anything(),
      shop.id,
      expect.objectContaining({ query: "Reyes", filter: "not_back", sort: "last_dived" }),
    );
  });

  it("does not read another shop's roster when the URL slug does not match the session shop", async () => {
    vi.mocked(getDb).mockResolvedValue({} as never);
    vi.mocked(requireStaffSession).mockResolvedValue({
      user: { shopId: shop.id, personId: "manager-id" },
    } as never);
    vi.mocked(getShopById).mockResolvedValue(shop as never);

    const response = await GET(
      new Request("https://diveday.test/shop/other-shop/divers/download"),
      { params: Promise.resolve({ shopSlug: "other-shop" }) },
    );

    expect(response.status).toBe(404);
    expect(canPersonExportShopData).not.toHaveBeenCalled();
    expect(listDiversForExport).not.toHaveBeenCalled();
  });

  it("refuses roster downloads without shop export permission", async () => {
    vi.mocked(getDb).mockResolvedValue({} as never);
    vi.mocked(requireStaffSession).mockResolvedValue({
      user: { shopId: shop.id, personId: "staff-id" },
    } as never);
    vi.mocked(getShopById).mockResolvedValue(shop as never);
    vi.mocked(canPersonExportShopData).mockResolvedValue(false);

    const response = await GET(new Request("https://diveday.test/shop/reef-shop/divers/download"), {
      params: Promise.resolve({ shopSlug: shop.slug }),
    });

    expect(response.status).toBe(403);
    expect(hasRequiredStepUp).not.toHaveBeenCalled();
    expect(listDiversForExport).not.toHaveBeenCalled();
  });

  it("requires export step-up before reading the roster", async () => {
    vi.mocked(getDb).mockResolvedValue({} as never);
    vi.mocked(requireStaffSession).mockResolvedValue({
      user: { shopId: shop.id, personId: "manager-id" },
    } as never);
    vi.mocked(getShopById).mockResolvedValue(shop as never);
    vi.mocked(canPersonExportShopData).mockResolvedValue(true);
    vi.mocked(hasRequiredStepUp).mockResolvedValue(false);
    vi.mocked(stepUpChallengeUrl).mockReturnValue("/shop/reef-shop/security/step-up");

    const response = await GET(
      new Request("https://diveday.test/shop/reef-shop/divers/download?q=Reyes"),
      { params: Promise.resolve({ shopSlug: shop.slug }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toContain("/shop/reef-shop/security/step-up");
    expect(listDiversForExport).not.toHaveBeenCalled();
  });
});
