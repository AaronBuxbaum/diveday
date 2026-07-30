import { expect, signedInAsOwner, test } from "./fixtures";

signedInAsOwner();

test("staff opens a diver from their avatar and can reach them from the header", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers");
  // The extended roster is well past one default page, sorted alphabetically —
  // search for her rather than assume she's on the unfiltered first page.
  await page.getByRole("searchbox", { name: "Search divers" }).fill("Priya Sharma");

  // The whole person cell is one link, so the initials avatar opens the diver
  // just like the name does.
  const row = page.getByRole("row").filter({ hasText: "Priya Sharma" });
  await row.getByText("PS", { exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Priya Sharma" })).toBeVisible();

  // Contact details are one tap from the front desk: mail the diver or call them.
  const header = page.locator("header").last();
  await expect(header.locator('a[href^="mailto:"]')).toBeVisible();
  await expect(header.locator('a[href^="tel:"]')).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // The table hides sideways columns behind a scroll on a 390px screen, so
  // the list swaps to stacked cards there — everything readable, no scroll.
  test("the divers list stacks into cards and still opens the diver", async ({ page }) => {
    await page.goto("/shop/blue-mantis/divers");
    await page.getByRole("searchbox", { name: "Search divers" }).fill("Priya Sharma");

    const card = page.getByRole("link", { name: /Priya Sharma/ });
    await expect(card).toBeVisible();
    await expect(card.getByText(/card/)).toBeVisible();
    await expect(page.getByRole("table")).toBeHidden();

    await card.click();
    await expect(page.getByRole("heading", { level: 1, name: "Priya Sharma" })).toBeVisible();
  });
});
