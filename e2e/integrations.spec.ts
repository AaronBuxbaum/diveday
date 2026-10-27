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

  test("shows a card only for what this build can connect, and fails closed without credentials", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    await page.goto(INTEGRATIONS_SETTINGS);
    await expect(page.getByRole("heading", { level: 1, name: "Your data" })).toBeVisible();
    // The fleet has the secret key Zapier needs and no Shopify or Intuit
    // credentials: a card for the one it can connect, and no card at all for
    // the two it cannot (visual review 2026-10-24, A20). No control appears
    // that could not act (principle 8).
    await expect(page.getByRole("heading", { name: "Zapier" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Shopify" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "QuickBooks Online" })).toHaveCount(0);
    // Its state is a line of text, not a pill, and the rest is one foot line.
    // The Settings rail's Payments badge says "Not connected" too (Stripe), so
    // the count is of the page's own words, outside any navigation.
    await expect(
      page.getByText("Not connected", { exact: true }).and(page.locator(":not(nav *)")),
    ).toHaveCount(1);
    await expect(page.getByText(/More integrations come later\. Ask us at .+\./)).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Connect Zapier" })).toBeVisible();
  });

  test("is reachable from Your data, the Settings group's one door", { tag: READ_ONLY }, async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/settings#data");
    await page
      .getByRole("main")
      .getByRole("link", { name: "Export, import, backups and integrations" })
      .click();
    await page
      .getByRole("navigation", { name: "Your data sections" })
      .getByRole("link", { name: "Integrations" })
      .click();
    await expect(page).toHaveURL(INTEGRATIONS_SETTINGS);
  });
});

test.describe("shop integrations authorization", () => {
  signedInAs("captain");

  test("a captain cannot reach provider credentials", { tag: READ_ONLY }, async ({ page }) => {
    await page.goto(INTEGRATIONS_SETTINGS);
    await expect(page.getByText("Only an owner or manager can change integrations.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Your data" })).toHaveCount(0);
  });
});
