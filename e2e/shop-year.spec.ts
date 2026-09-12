import type { Locator, Page } from "@playwright/test";
import { expect, READ_ONLY, signedInAsOwner, test } from "./fixtures";

/**
 * The year switch's own form, by the name its heading gives it.
 *
 * Settings' Lobby display page holds several forms and more than one of them
 * has a Save button, so a bare `getByRole("button", { name: "Save" })` is a
 * strict-mode violation the moment a sibling slice adds another one. Scoped to
 * the form, it stays right however many neighbours arrive.
 */
function yearForm(page: Page): Locator {
  return page.getByRole("form", { name: /year on DiveDay/i });
}

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
    await expect(page.getByRole("heading", { level: 1, name: "How’s your month" })).toBeVisible();

    await page.getByRole("link", { name: "This year" }).click();
    // The destination's own render first, then the URL: a client navigation
    // resolves the two in that order, and waiting on the URL alone times out
    // on a loaded box while the page it names is already on its way.
    await expect(page.getByRole("heading", { level: 1, name: "How’s your year" })).toBeVisible();
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
    await expect(page.getByRole("heading", { level: 1, name: "How’s your month" })).toBeVisible();
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

  test("the public card is closed until the shop opens it", { tag: READ_ONLY }, async ({
    request,
  }) => {
    // blue-mantis has not turned the switch on, so the public route does not
    // exist for it — the switch is the whole gate.
    const response = await request.get("/s/blue-mantis/year-card");
    expect(response.status()).toBe(404);
  });
});

test.describe("the switch, on a shop of the test's own", () => {
  test("an owner turns their year on and off again", async ({ page, request, privateShop }) => {
    // The mint and the live sign-in the fixture pays for come out of this
    // test's own budget.
    test.setTimeout(90_000);

    await page.goto(`/shop/${privateShop.slug}/settings/display`);
    await expect(page.getByRole("heading", { name: "Our year on DiveDay’s pages" })).toBeVisible();
    await page.getByLabel("Show our year on DiveDay’s pages").check();
    await yearForm(page).getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/notice=year-on-diveday/);
    await expect(page.getByText("Your year is on DiveDay’s pages.")).toBeVisible();

    // **And a demo tenant still gets nothing.** `privateShop` mints the same
    // `isDemo` shop "Try the live demo" hands a visitor, whose shop, boat and
    // site names that visitor types — so the switch is on and the public card
    // is still a 404, and the homepage still carries no band (security review,
    // finding 1). The band's own flow is the real shop below.
    expect((await request.get(`/s/${privateShop.slug}/year-card`)).status()).toBe(404);
    await page.goto("/");
    await expect(page.getByText("A real shop’s year")).toHaveCount(0);

    await page.goto(`/shop/${privateShop.slug}/settings/display`);
    await page.getByLabel("Show our year on DiveDay’s pages").uncheck();
    await yearForm(page).getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/notice=year-off-diveday/);
    await expect(page.getByText("Your year is off DiveDay’s pages.")).toBeVisible();
  });
});

/**
 * The band itself, against a **real** shop — `/api/test/seed-year-band-shop`,
 * which mints one out of search with a year's worth of sailed departures and
 * the switch on (`src/db/seed-year-band.ts`). It has to be a real shop: the
 * band and the public card both refuse `isDemo`, which is the whole of finding
 * 1. Dropped on the way out, and `/api/test/reset` drops it again before every
 * test, so nothing it leaves behind can reach another spec's homepage.
 */
test.describe("a real shop's year on DiveDay's pages", () => {
  test("the homepage carries the card, and loses it when the shop is gone", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);

    // Nothing is shown until a real shop says yes.
    await page.goto("/");
    await expect(page.getByText("A real shop’s year")).toHaveCount(0);

    const seeded = await request.post("/api/test/seed-year-band-shop");
    expect(seeded.ok()).toBe(true);
    const { slug } = (await seeded.json()) as { slug: string };

    const card = await request.get(`/s/${slug}/year-card`);
    expect(card.status()).toBe(200);
    expect(card.headers()["content-type"]).toContain("image/png");

    await page.goto("/");
    await expect(page.getByText("A real shop’s year")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /has run \d+ boats? on DiveDay this year\./ }),
    ).toBeVisible();
    await expect(page.getByText("Shown here because the shop turned it on.")).toBeVisible();
    await expect(page.getByRole("link", { name: "See their storefront" })).toHaveAttribute(
      "href",
      `/s/${slug}`,
    );

    const dropped = await request.delete("/api/test/seed-year-band-shop");
    expect(dropped.ok()).toBe(true);
    expect((await request.get(`/s/${slug}/year-card`)).status()).toBe(404);
    await page.goto("/");
    await expect(page.getByText("A real shop’s year")).toHaveCount(0);
  });
});
