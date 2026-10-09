import { expect, test } from "./fixtures";

/**
 * **A diver buys a dive package online** (owner decision 2026-10-09; ADR
 * 20260822-a-package-is-entitlements-not-money).
 *
 * The public nav offers Packages only while one is on sale, the page is the
 * one form, and Buy raises an invoice on the shop's connected account. This
 * fleet sets no `STRIPE_SECRET_KEY`, so the last step stops at "the payment
 * page didn't open" — which is the proof the action got as far as Stripe with
 * the package's own price, and that it says so rather than pretending.
 *
 * A shop of its own (ADR 20260815-per-test-private-shops): a package is shop
 * configuration, and one written into blue-mantis would survive into the
 * captures that photograph that shop.
 */
test("a shop's packages earn a tab, and Buy goes to Stripe or says why not", async ({
  page,
  request,
  privateShop,
}) => {
  // A mint, a sign-in and a staff save before the public half starts.
  test.setTimeout(90_000);
  const SHOP = privateShop.slug;
  const nav = page.getByRole("navigation", { name: /.+/ }).filter({ hasText: "Schedule" });

  // Nothing on sale: no tab, and no page behind the URL either.
  await page.goto(`/s/${SHOP}`);
  await expect(nav.getByRole("link", { name: "Packages" })).toHaveCount(0);
  // The page's own `notFound()`, the second layer behind the edge (the shop
  // exists, so the proxy lets the URL through and the page refuses it).
  await page.goto(`/s/${SHOP}/packages`);
  await expect(page.getByRole("heading", { name: "That page isn’t here any more" })).toBeVisible();

  await page.goto(`/shop/${SHOP}/promos/packages`);
  await page.getByLabel("What you call it").fill("Ten-dive card");
  await page.getByLabel("Dives included").fill("10");
  await page.getByLabel("Price").fill("450");
  await page.getByRole("button", { name: "Add package" }).click();
  await expect(page.getByText("Package added.")).toBeVisible();

  await page.goto(`/s/${SHOP}`);
  await nav.getByRole("link", { name: "Packages" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Dive packages" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Ten-dive card/ })).toBeChecked();
  await expect(page.getByText(/10 dives · \$45 a dive/)).toBeVisible();

  const buy = page.getByRole("button", { name: "Buy for $450" });
  await expect(buy.locator("xpath=ancestor::form")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name").fill("Ola Online");
  await page.getByLabel("Email").fill("ola.online@example.com");

  // No connected account yet: the shop is named, and nothing is charged.
  await buy.click();
  await expect(page.getByText(/can’t take this payment online right now/)).toBeVisible();

  // Connected, but this fleet has no Stripe key: the invoice is attempted and
  // the diver is told plainly that the payment page did not open.
  const connected = await request.post(
    `/api/test/seed-stripe-account?slug=${encodeURIComponent(SHOP)}`,
  );
  expect(connected.ok()).toBe(true);
  await buy.click();
  await expect(
    page.getByText("The payment page didn’t open. Nothing was charged. Try again in a moment."),
  ).toBeVisible();
});
