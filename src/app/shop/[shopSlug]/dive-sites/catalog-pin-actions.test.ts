import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ gate: vi.fn(), read: vi.fn() }));
vi.mock("@/features/session", () => ({ requireShopSurface: mocks.gate }));
vi.mock("@/db/dive-sites", () => ({ getGlobalDiveSiteTemplate: mocks.read }));
vi.mock("@/i18n/request", () => ({ requestLocale: async () => "en-US" }));

import { catalogPinDetailsAction } from "./catalog-pin-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gate.mockResolvedValue({ db: "db", shop: { defaultLocale: "en-US", depthUnit: "m" } });
  mocks.read.mockResolvedValue({
    version: { briefing: { description: "A".repeat(500), difficultyLevel: "beginner" } },
  });
});

describe("catalog detail action", () => {
  it("gates the shop live before the current published template read", async () => {
    const result = await catalogPinDetailsAction("demo", "reef");
    expect(mocks.gate).toHaveBeenCalledExactlyOnceWith("demo");
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith("db", "reef");
    expect(result?.description).toHaveLength(360);
    expect(Object.keys(result ?? {})).toEqual(["details", "description"]);
  });

  it("never reads the catalog on a cross-tenant or demoted session refusal", async () => {
    mocks.gate.mockRejectedValueOnce(new Error("not found"));
    await expect(catalogPinDetailsAction("other-shop", "reef")).rejects.toThrow("not found");
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("returns nothing for a missing published template or invalid slug", async () => {
    mocks.read.mockResolvedValueOnce(null);
    expect(await catalogPinDetailsAction("demo", "missing")).toBeNull();
    mocks.read.mockClear();
    expect(await catalogPinDetailsAction("demo", "a".repeat(201))).toBeNull();
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
