import { deriveBrandTheme } from "@/lib/brand";
import { expect, test } from "./fixtures";

/** `#rrggbb` as `getComputedStyle` spells it. */
function cssRgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Harbor (ADR 20260901-diveday-reimagined, decision 2): the storefront and the
 * embed wear the shop's brand. Blue Mantis is seeded with mantis green, a
 * cover photo, three badges and an opening year, so the page a diver lands on
 * shows the wall and its primary action is the shop's colour — and the widget
 * a shop pastes on its own site inherits the same colour with no chrome.
 */
test.describe("the storefront wears the shop's brand", () => {
  test("the badge wall and the cover photo lead, and the book button is the shop's colour", async ({
    page,
  }) => {
    await page.goto("/s/blue-mantis");
    await expect(page.getByRole("heading", { level: 1, name: "Blue Mantis Divers" })).toBeVisible();
    await expect(
      page.getByAltText("Elkhorn coral on Molasses Reef, sunlight from above"),
    ).toBeVisible();
    await expect(page.getByText("Since 1998")).toBeVisible();
    await expect(page.getByText("PADI 5 Star Dive Center")).toBeVisible();
    await expect(page.getByRole("link", { name: "Bookings by DiveDay" })).toBeVisible();

    // The seeded brand colour, as the fill of the storefront's one primary.
    const fill = await page
      .getByRole("link", { name: /Book this boat/ })
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    // The seeded green as `BrandStyle` derives it (`deriveBrandTheme`), as the
    // browser reports a computed background: `rgb(r, g, b)`.
    expect(fill).toBe(cssRgb(deriveBrandTheme("#158462").primary));
  });

  test("the embed inherits the colour and carries no wall", async ({ page }) => {
    await page.goto("/s/blue-mantis?embed=1");
    await expect(page.getByText("Powered by DiveDay")).toBeVisible();
    await expect(page.getByText("Since 1998")).toHaveCount(0);
    const primary = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
    );
    // The seeded green as `BrandStyle` derives it — darkened until it reads as
    // text on sand (`deriveBrandTheme`) — never the raw hex from src/db/seed.ts.
    expect(primary).toBe(deriveBrandTheme("#158462").primary);
  });
});
