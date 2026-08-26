import { expect, READ_ONLY, signedInAs, test } from "./fixtures";

const INTEGRATIONS_SETTINGS = "/shop/blue-mantis/settings/integrations";

/**
 * Provider OAuth and outbound API calls stay behind injected unit tests: the
 * browser fleet deliberately has no Shopify/Intuit client secrets and cannot
 * depend on third-party HTTP. This covers the safe, useful deployment state —
 * the page explains that provider credentials are required and offers no dead
 * connection button.
 */
test.describe("shop integrations settings", () => {
  signedInAs("owner");

  test("shows the three provider surfaces and fails closed without credentials", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    await page.goto(INTEGRATIONS_SETTINGS);
    await expect(page.getByRole("heading", { level: 1, name: "Shop integrations" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Shopify" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "QuickBooks Online" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Zapier" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Not configured", exact: true })).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Connect Zapier" })).toBeVisible();
  });

  test("is reachable from the data and integrations settings group", { tag: READ_ONLY }, async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/settings");
    await page
      .getByRole("main")
      .getByRole("link", { name: "Shopify, QuickBooks & Zapier" })
      .click();
    await expect(page).toHaveURL(INTEGRATIONS_SETTINGS);
  });
});

test.describe("shop integrations authorization", () => {
  signedInAs("captain");

  test("a captain cannot reach provider credentials", { tag: READ_ONLY }, async ({ page }) => {
    await page.goto(INTEGRATIONS_SETTINGS);
    await expect(page.getByText("Only an owner or manager can change integrations.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Shop integrations" })).toHaveCount(0);
  });
});
