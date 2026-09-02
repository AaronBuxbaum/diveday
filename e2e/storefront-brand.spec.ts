import { expect, test } from "./fixtures";

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
    expect(fill).toBe("rgb(19, 121, 90)");
  });

  test("the embed inherits the colour and carries no wall", async ({ page }) => {
    await page.goto("/s/blue-mantis?embed=1");
    await expect(page.getByText("Powered by DiveDay")).toBeVisible();
    await expect(page.getByText("Since 1998")).toHaveCount(0);
    const primary = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
    );
    expect(primary).toBe("#13795a");
  });
});
