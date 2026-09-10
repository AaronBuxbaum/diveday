import { expect, READ_ONLY, signedInAsOwner, test } from "./fixtures";

/**
 * **The shop's year** (ADR 20260908-one-hand, decision 6, lever T): Reports
 * gains a second reading of itself, the card leaves the shop as one image, and
 * a switch — off until an owner turns it on — puts that card on DiveDay's own
 * homepage.
 *
 * The switch is shop-wide configuration, which `/api/test/reset` deliberately
 * does **not** restore, so every test that touches it takes a shop of its own
 * (`privateShop`, ADR 20260815-per-test-private-shops). The read-only half
 * below stays on the shared blue-mantis fixture.
 */

test.describe("the year on Reports", () => {
  signedInAsOwner();

  test("an owner reads the year beside the month", { tag: READ_ONLY }, async ({ page }) => {
    await page.goto("/shop/blue-mantis/reports");
    await expect(page.getByRole("heading", { level: 1, name: "How's your month" })).toBeVisible();

    await page.getByRole("link", { name: "This year" }).click();
    // The destination's own render first, then the URL: a client navigation
    // resolves the two in that order, and waiting on the URL alone times out
    // on a loaded box while the page it names is already on its way.
    await expect(page.getByRole("heading", { level: 1, name: "How's your year" })).toBeVisible();
    await expect(page).toHaveURL(/reports\?range=year/);
    // The sentence the year says, then the four figures under the strip.
    await expect(page.getByText(/\d+ divers?, \d+ boats? out, \d+ sites?\./)).toBeVisible();
    const figures = page.getByRole("region", { name: "The year's numbers" });
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
    await expect(page.getByRole("heading", { level: 1, name: "How's your month" })).toBeVisible();
    await expect(page.getByRole("region", { name: "This month's numbers" })).toBeVisible();
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

  test("the public card is closed until the shop opens it", { tag: READ_ONLY }, async ({
    request,
  }) => {
    // blue-mantis has not turned the switch on, so the public route does not
    // exist for it — the switch is the whole gate.
    const response = await request.get("/s/blue-mantis/year-card");
    expect(response.status()).toBe(404);
  });
});

test.describe("the shop's yes, on a shop of the test's own", () => {
  test("turning the switch on puts the card on DiveDay's homepage", async ({
    page,
    request,
    privateShop,
  }) => {
    // The mint and the live sign-in the fixture pays for come out of this
    // test's own budget.
    test.setTimeout(90_000);

    // Nothing is shown until a shop says yes: the band does not render, and the
    // public card route is a 404.
    await page.goto("/");
    await expect(page.getByText("A real shop's year")).toHaveCount(0);
    expect((await request.get(`/s/${privateShop.slug}/year-card`)).status()).toBe(404);

    await page.goto(`/shop/${privateShop.slug}/settings/display`);
    await expect(page.getByRole("heading", { name: "Our year on DiveDay's pages" })).toBeVisible();
    await page.getByLabel("Show our year on DiveDay's pages").check();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/notice=year-on-diveday/);
    await expect(page.getByText("Your year is on DiveDay's pages.")).toBeVisible();

    // The card is now public, and the homepage carries it with the one
    // sentence a number on it can prove.
    expect((await request.get(`/s/${privateShop.slug}/year-card`)).status()).toBe(200);
    await page.goto("/");
    await expect(page.getByText("A real shop's year")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /has run \d+ boats? on DiveDay this year\./ }),
    ).toBeVisible();
    await expect(page.getByText("Shown here because the shop turned it on.")).toBeVisible();
    await expect(page.getByRole("link", { name: "See their storefront" })).toHaveAttribute(
      "href",
      `/s/${privateShop.slug}`,
    );

    // And turning it off takes both down again.
    await page.goto(`/shop/${privateShop.slug}/settings/display`);
    await page.getByLabel("Show our year on DiveDay's pages").uncheck();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/notice=year-off-diveday/);
    expect((await request.get(`/s/${privateShop.slug}/year-card`)).status()).toBe(404);
    await page.goto("/");
    await expect(page.getByText("A real shop's year")).toHaveCount(0);
  });
});
