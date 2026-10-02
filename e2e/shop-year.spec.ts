import { expect, READ_ONLY, signedInAsOwner, test } from "./fixtures";

/**
 * **The shop's year** (ADR 20260908-one-hand, decision 6, lever T): Reports
 * gains a second reading of itself, and the card leaves the shop as one image.
 * Read-only, on the shared blue-mantis fixture.
 */

test.describe("the year on Reports", () => {
  signedInAsOwner();

  test("an owner reads the year beside the month", { tag: READ_ONLY }, async ({ page }) => {
    await page.goto("/shop/blue-mantis/reports");
    await expect(page.getByRole("heading", { level: 1, name: "Money" })).toBeVisible();

    await page.getByRole("link", { name: "This year" }).click();
    // The destination's own render first, then the URL: a client navigation
    // resolves the two in that order, and waiting on the URL alone times out
    // on a loaded box while the page it names is already on its way.
    await expect(page.getByRole("heading", { level: 1, name: "Money" })).toBeVisible();
    await expect(page).toHaveURL(/reports\?range=year/);
    // The sentence the year says, then the four figures under the strip.
    await expect(page.getByText(/\d+ divers?, \d+ boats? out, \d+ sites?\./)).toBeVisible();
    const figures = page.getByRole("region", { name: "The year’s numbers" });
    await expect(figures.getByText("Divers", { exact: true })).toBeVisible();
    await expect(figures.getByText("Boats out", { exact: true })).toBeVisible();
    await expect(figures.getByText("Busiest day", { exact: true })).toBeVisible();
    await expect(figures.getByText("Quietest month", { exact: true })).toBeVisible();

    // **Never money on the year.** The month keeps it; this page must not have
    // inherited it, and the assertion is on the labels rather than on a
    // currency glyph, which a shop in another currency would not print.
    await expect(figures.getByText("Net revenue")).toHaveCount(0);
    await expect(page.getByText(/Tax collected/)).toHaveCount(0);
  });

  test("the month page is one tap back", { tag: READ_ONLY }, async ({ page }) => {
    await page.goto("/shop/blue-mantis/reports?range=year");
    await page.getByRole("link", { name: "This month" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Money" })).toBeVisible();
    await expect(page.getByRole("region", { name: "This month’s numbers" })).toBeVisible();
  });

  test("the card is an image the year page hands over", { tag: READ_ONLY }, async ({
    page,
    request,
  }) => {
    await page.goto("/shop/blue-mantis/reports?range=year");
    const card = page.getByRole("link", { name: "Print the card" });
    await expect(card).toBeVisible();
    const href = await card.getAttribute("href");
    expect(href).toBe("/shop/blue-mantis/reports/card");
    const response = await request.get(href ?? "");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");
  });
});
