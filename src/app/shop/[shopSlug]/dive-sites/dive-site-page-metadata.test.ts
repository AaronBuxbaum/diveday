import { beforeEach, describe, expect, it, vi } from "vitest";

const { gate, getSite, getTemplate } = vi.hoisted(() => ({
  gate: vi.fn(),
  getSite: vi.fn(),
  getTemplate: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireShopSurface: gate }));
vi.mock("@/i18n/request", () => ({ requestLocale: () => Promise.resolve("en-US") }));
vi.mock("@/db/dive-sites", () => ({
  getDiveSite: getSite,
  getGlobalDiveSiteTemplate: getTemplate,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import { catalogPageMetadata, librarySitePageMetadata } from "./dive-site-page-metadata";

beforeEach(() => {
  vi.resetAllMocks();
  gate.mockResolvedValue({ db: "db", shop: { id: "shop-id", depthUnit: "meters" } });
});

describe("dive site page titles", () => {
  it("uses the published template's name on a catalog preview", async () => {
    getTemplate.mockResolvedValue({ version: { briefing: { name: "Molasses Reef" } } });
    expect(
      await catalogPageMetadata("blue-mantis", { view: "catalog", template: "molasses-reef" }),
    ).toEqual({ title: "Molasses Reef — DiveDay" });
    expect(getTemplate).toHaveBeenCalledWith("db", "molasses-reef", {
      id: "shop-id",
      depthUnit: "meters",
    });
  });
  it("keeps the generic title on the list", async () => {
    expect(await catalogPageMetadata("blue-mantis", {})).toEqual({ title: "Dive sites — DiveDay" });
    expect(getTemplate).not.toHaveBeenCalled();
  });
  it("uses a library site's name only from the authorized shop", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    getSite.mockResolvedValue({ name: "North Reef" });
    expect(await librarySitePageMetadata("blue-mantis", id)).toEqual({
      title: "North Reef — DiveDay",
    });
    expect(getSite).toHaveBeenCalledWith("db", "shop-id", id);
  });
  it("does not read a template when authorization refuses", async () => {
    gate.mockRejectedValue(new Error("NOT_FOUND"));
    await expect(
      catalogPageMetadata("other-shop", { view: "catalog", template: "molasses-reef" }),
    ).rejects.toThrow("NOT_FOUND");
    expect(getTemplate).not.toHaveBeenCalled();
  });
  it("does not read a private site's name when the shop gate refuses", async () => {
    gate.mockRejectedValue(new Error("NOT_FOUND"));
    await expect(
      librarySitePageMetadata("other-shop", "11111111-1111-4111-8111-111111111111"),
    ).rejects.toThrow("NOT_FOUND");
    expect(getSite).not.toHaveBeenCalled();
  });
  it("refuses malformed site ids before querying", async () => {
    await expect(librarySitePageMetadata("blue-mantis", "bad-id")).rejects.toThrow("NOT_FOUND");
    expect(getSite).not.toHaveBeenCalled();
  });
  it("refuses absent library sites without returning another shop's title", async () => {
    getSite.mockResolvedValue(null);
    await expect(
      librarySitePageMetadata("blue-mantis", "11111111-1111-4111-8111-111111111111"),
    ).rejects.toThrow("NOT_FOUND");
  });
});
