import { expect, signedInAs, test } from "./fixtures";

/**
 * The Monday email (market audit item 51): the staffer's own Email settings,
 * the toggle that decides whether they get it, and the preview of this week's.
 *
 * The toggle writes `user_accounts.weekly_digest`, which the per-test reset
 * does not restore, so the test that flips it takes a shop of its own
 * (`privateShop`) and signs in as that shop's owner. The read-only tests sign
 * in to the shared demo shop.
 */
const emailSettingsFor = (shopSlug: string) => `/shop/${shopSlug}/settings/email`;

test.describe("the Monday email, on a shop of the test's own", () => {
  test("an owner gets it by default and can turn it off and back on", async ({
    page,
    privateShop,
  }) => {
    test.setTimeout(60_000);
    await page.goto(emailSettingsFor(privateShop.slug));
    await expect(page.getByRole("heading", { level: 1, name: "Email" })).toBeVisible();
    // The page holds a second toggle (the after-hours ping), so this one is
    // read inside its own card.
    const main = page.getByRole("region", { name: "Monday email" });
    await expect(main.getByText("On", { exact: true })).toBeVisible();

    await main.getByRole("button", { name: "Turn off" }).click();
    await expect(main.getByRole("button", { name: "Turn on" })).toBeVisible();
    await expect(main.getByText("Off", { exact: true })).toBeVisible();

    await page.reload();
    await expect(main.getByText("Off", { exact: true })).toBeVisible();
    await main.getByRole("button", { name: "Turn on" }).click();
    await expect(main.getByRole("button", { name: "Turn off" })).toBeVisible();
    await expect(main.getByText("On", { exact: true })).toBeVisible();
  });
});

test.describe("the Monday email preview", () => {
  signedInAs("owner");

  test("Account settings opens Email settings", async ({ page }) => {
    await page.goto("/shop/blue-mantis/settings");
    await page.locator("header [data-identity-menu]").click();
    await page.locator("header").getByRole("link", { name: "Account settings" }).click();
    await page
      .getByRole("navigation", { name: "Account security" })
      .getByRole("link", { name: "Email settings" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Email" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Monday email" })).toBeVisible();
  });

  test("renders this week's email, or says none would go out", async ({ page }) => {
    await page.goto(`${emailSettingsFor("blue-mantis")}/preview`);
    await expect(
      page.getByText(/Weeks run Monday to Sunday|no email goes out this Monday/),
    ).toBeVisible();
  });

  // **The owner's Monday email says what the week made** (third UX review,
  // item 33). The demo holds open orders, so the money section has something
  // to say, and its link opens Orders.
  test("gives the owner the week's money", async ({ page }) => {
    await page.goto(`${emailSettingsFor("blue-mantis")}/preview`);
    await expect(page.getByRole("heading", { name: "Money" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Money" })).toHaveAttribute(
      "href",
      /\/shop\/blue-mantis\/orders$/,
    );
  });
});

test.describe("the Monday email for a staffer who is not an owner", () => {
  signedInAs("divemaster");

  test("reaches their own Email settings with the email off by default", async ({ page }) => {
    await page.goto(emailSettingsFor("blue-mantis"));
    const main = page.getByRole("region", { name: "Monday email" });
    await expect(main.getByRole("heading", { name: "Monday email" })).toBeVisible();
    await expect(main.getByText("Off", { exact: true })).toBeVisible();
    await expect(main.getByRole("button", { name: "Turn on" })).toBeVisible();
  });

  test("previews a week with no money in it", async ({ page }) => {
    await page.goto(`${emailSettingsFor("blue-mantis")}/preview`);
    await expect(
      page.getByText(/Weeks run Monday to Sunday|no email goes out this Monday/),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Money" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open Money" })).toHaveCount(0);
  });
});
