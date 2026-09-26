// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buttonClass } from "@/components/ui/button";

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
 * phone (K-396), the only door in a band a visitor reads on their phone. It is
 * spelled as the landing's other start-of-line doors are, the md link passed
 * `flush`: a 48px floor, the same ink, its words on the column.
 */
describe("the shop-year band's door", () => {
  it("is the landing's band door, a 48px target and not a 24px line", async () => {
    render(await ShopYearBand({ locale: "en-US" }));
    const door = screen.getByRole("link", { name: "See their storefront" });
    const bandDoor = buttonClass({ variant: "link", flush: true }).split(/\s+/).filter(Boolean);
    expect(door).toHaveClass(...bandDoor);
    expect(door).not.toHaveClass("inline-block");
    // The md size's 48px floor, over the base's 44px.
    expect(door).toHaveClass("min-h-12");
  });

  it("keeps its words 24px under the note: the box's 12px above the line comes off the margin", async () => {
    render(await ShopYearBand({ locale: "en-US" }));
    const door = screen.getByRole("link", { name: "See their storefront" });
    // (48 − 24) / 2 = 12px of box above the 24px line, so 12px of margin
    // leaves the words where `mt-6` put them.
    expect(door).toHaveClass("mt-3");
    expect(door).not.toHaveClass("mt-6");
    expect(door).not.toHaveClass("mt-3.5");
  });
});
