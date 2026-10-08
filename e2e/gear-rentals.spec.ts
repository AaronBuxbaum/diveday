import { expect, signedInAsOwner, test } from "./fixtures";

/**
 * **The register's Rentals view** (plan `rental-tracking`, layer 2): every
 * open rental by who holds it, reached from the register's own filter band
 * like Service due and Deleted. The demo reserves four units on the wreck
 * trip for two divers (`seed-gear.ts`); the trouble seed drags the first
 * diver's kit into the past, which is the state a desk chases.
 */
test.describe("staff", () => {
  signedInAsOwner();

  test("lists who has the shop's gear, and opens a holder's rental ticket", async ({ page }) => {
    await page.goto("/shop/blue-mantis/gear");
    await page.getByRole("link", { name: /^Rentals \(\d+\)$/ }).click();
    await page.waitForURL(/\/gear\?view=rentals$/);

    const rentals = page.getByRole("region", { name: "Rentals" });
    await expect(rentals.getByRole("link", { name: "BCD #2" })).toBeVisible();
    await expect(rentals.getByRole("link", { name: "BCD #5" })).toBeVisible();
    // The wall's units are not rentals; the register's own view still lists them.
    await expect(rentals.getByRole("link", { name: "AL80-03" })).toHaveCount(0);

    const firstSet = rentals
      .getByRole("listitem")
      .filter({ has: page.getByRole("link", { name: "BCD #2" }) })
      .first();
    await expect(firstSet.getByRole("link", { name: "Wreck Trip — Spiegel Grove" })).toBeVisible();
    await expect(firstSet.getByText("Reserved", { exact: true })).toBeVisible();
    await expect(firstSet.getByRole("link", { name: "Reg #1" })).toBeVisible();

    await firstSet.getByRole("link", { name: /^Rental ticket for / }).click();
    await page.waitForURL(/\/prep\/ticket\/[^/]+$/);
    await expect(page.getByRole("heading", { name: "What you have" })).toBeVisible();
    await expect(page.getByText("BCD #2")).toBeVisible();

    await page.goto("/shop/blue-mantis/gear");
    await expect(page.getByRole("link", { name: "AL80-03" })).toBeVisible();
  });

  test("leads with the overdue set, and a unit that differs from its set says so", async ({
    page,
    request,
  }) => {
    await request.post("/api/test/seed-trouble-states?gearOut=1");
    await page.goto("/shop/blue-mantis/gear?view=rentals");
    const rentals = page.getByRole("region", { name: "Rentals" });
    const late = rentals
      .getByRole("listitem")
      .filter({ has: page.getByRole("link", { name: "BCD #2" }) })
      .first();
    await expect(late.getByText("Overdue", { exact: true })).toBeVisible();
    // Reg #1 was dragged onto today by `?gearOut=1`, so it says its own state.
    const reg = late
      .getByRole("listitem")
      .filter({ has: page.getByRole("link", { name: "Reg #1" }) });
    await expect(reg.getByText("Due back today", { exact: true })).toBeVisible();

    // The overdue holder leads the page: their set is in its first group.
    await expect(
      rentals.locator("ul[aria-labelledby]").first().getByRole("link", { name: "BCD #2" }),
    ).toBeVisible();
  });
});
