import { expect, signedInAsOwner, test } from "./fixtures";
import { offlineCopySaved, seededTripId } from "./helpers";

signedInAsOwner();
for (const width of [390, 1280]) {
  test(`Trip omits its Schedule backlink but the manifest retains an escape at ${width}px`, async ({
    page,
  }) => {
    const id = await seededTripId(page, "blue-mantis", "Two-Tank Reef — Molasses & French");
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/shop/blue-mantis/trips/${id}`);
    const header = page.locator("main header").first();
    await expect(header.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(header.getByRole("link", { name: "Schedule" })).toHaveCount(0);
    await page.goto(`/shop/blue-mantis/trips/${id}/manifest`);
    await offlineCopySaved(page);
    await expect(
      page.locator("main").getByRole("link", { name: "Schedule", exact: true }),
    ).toHaveAttribute("href", "/shop/blue-mantis/schedule/board");
    await page.goBack();
    await expect(header.getByRole("heading", { level: 1 })).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/manifest/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
