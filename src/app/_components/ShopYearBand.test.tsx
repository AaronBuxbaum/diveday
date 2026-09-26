// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The band reads the database for the shop that turned the switch on; the
// geometry under test needs only one such shop with a year behind it.
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/db/shops", () => ({
  listShopsShowingYearOnDiveday: vi.fn(async () => [
    { id: "shop-1", slug: "tern-rock", name: "Tern Rock Dive Club", timezone: "America/New_York" },
  ]),
}));
vi.mock("@/db/reporting", () => ({ getShopYear: vi.fn(async () => ({})) }));
vi.mock("@/lib/shop-year", () => ({
  summarizeShopYear: vi.fn(() => ({ hasActivity: true, divers: 204, boatsOut: 26, siteCount: 2 })),
}));

const { ShopYearBand } = await import("./ShopYearBand");

afterEach(cleanup);

/**
 * **The band's one door is a tap target** (docs/design/pixel-craft.md, class
 * 7). "See their storefront" was an `inline-block` word, 144 × 24px on a
 * phone (K-396), the only door in a band a visitor reads on their phone. It
 * takes `tapTargetLinkClass`'s 44px floor like every other text link that is
 * the whole action.
 */
describe("the shop-year band's door", () => {
  it("is a 44px target, not a 24px line", async () => {
    render(await ShopYearBand({ locale: "en-US" }));
    const door = screen.getByRole("link", { name: "See their storefront" });
    expect(door).toHaveClass("inline-flex", "min-h-11", "items-center");
    expect(door).not.toHaveClass("inline-block");
  });

  it("keeps its words 24px under the note: the box's 10px above the line comes off the margin", async () => {
    render(await ShopYearBand({ locale: "en-US" }));
    const door = screen.getByRole("link", { name: "See their storefront" });
    // (44 − 24) / 2 = 10px of box above the 24px line, so 14px of margin
    // leaves the words where `mt-6` put them.
    expect(door).toHaveClass("mt-3.5");
    expect(door).not.toHaveClass("mt-6");
  });
});
