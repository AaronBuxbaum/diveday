import { expect, test } from "./fixtures";

/**
 * The set-up request form (ADR 20261007-setup-request-form): the door every
 * public "Get set up" button opens, end to end — a refusal that keeps what was
 * typed, then a sent request landing on the thank-you page with the demo door.
 *
 * The stored row, the onboarding mail and the analytics event are the action's
 * unit tests (`src/app/get-set-up/actions.test.ts`); this spec is what a shop
 * owner sees.
 */

test("a shop asks to be set up from the pricing page and lands on the thank-you page", async ({
  page,
}) => {
  await page.goto("/pricing");
  await page.getByRole("main").getByRole("link", { name: "Get set up" }).first().click();
  await expect(page).toHaveURL(/\/get-set-up\?from=pricing$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Get your shop set up");
  // The page's funnel tag rides along in the form, so the request reads per surface.
  await expect(page.getByRole("main").locator('input[name="source"][value="pricing"]')).toHaveCount(
    1,
  );

  const unique = `set-up-${Date.now()}`;
  await page.getByLabel("Shop name").fill("Reef Line Divers");
  await page.getByLabel("Town or region").fill("Key Largo, FL");
  await page.getByRole("radio", { name: "Yes" }).check();
  await page.getByRole("radio", { name: "Spreadsheets" }).check();
  await page.getByLabel("Your name").fill("Ana Ruiz");
  // A malformed address is refused in place, and nothing typed is lost.
  // An address with no dot in its domain passes the browser's own check and
  // not the server's, so this is the server's refusal.
  await page.getByLabel("Email").fill(`${unique}@example`);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Check the address.")).toBeVisible();
  await expect(page).toHaveURL(/\/get-set-up\?from=pricing$/);
  await expect(page.getByLabel("Shop name")).toHaveValue("Reef Line Divers");
  await expect(page.getByRole("radio", { name: "Spreadsheets" })).toBeChecked();

  await page.getByLabel("Email").fill(`${unique}@example.com`);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page).toHaveURL(/\/get-set-up\/sent$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Request sent");
  // The demo is the one thing left to do while the reply is on its way.
  await expect(page.getByRole("button", { name: "Try the live demo" })).toBeVisible();
});

test("every closed door to a trial now opens the set-up form", async ({ page }) => {
  await page.goto("/onboard");
  await page.getByRole("main").getByRole("link", { name: "Get set up" }).click();
  await expect(page).toHaveURL(/\/get-set-up\?from=onboard-closed$/);
  await expect(page.getByLabel("Shop name")).toBeVisible();
});
