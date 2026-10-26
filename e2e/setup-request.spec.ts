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
  await page.getByRole("combobox", { name: "Current tool (optional)" }).selectOption("spreadsheet");
  await page.getByLabel("Your name").fill("Ana Ruiz");
  // A malformed address is refused in place, and nothing typed is lost.
  // An address with no dot in its domain passes the browser's own check and
  // not the server's, so this is the server's refusal.
  await page.getByLabel("Email").fill(`${unique}@example`);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Check the address.")).toBeVisible();
  await expect(page).toHaveURL(/\/get-set-up\?from=pricing$/);
  await expect(page.getByLabel("Shop name")).toHaveValue("Reef Line Divers");
  await expect(page.getByRole("combobox", { name: "Current tool (optional)" })).toHaveValue(
    "spreadsheet",
  );

  await page.getByLabel("Email").fill(`${unique}@example.com`);
  await page.getByRole("button", { name: "Send" }).click();
  // The sent page carries what the shop uses today, for its export step.
  await expect(page).toHaveURL(/\/get-set-up\/sent(?:\?|$)/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Request sent");
  await expect(page.getByRole("link", { name: "Contact DiveDay" })).toHaveAttribute(
    "href",
    "mailto:support@dive.day",
  );
  // The demo is the one thing left to do while the reply is on its way.
  // Scoped to `main`: the nav carries its own demo door on this page too
  // (visual review 2026-10-24, B43).
  await expect(
    page.getByRole("main").getByRole("button", { name: "Try the live demo" }),
  ).toBeVisible();
  // The demo journey moved here with the actual sent request, rather than
  // remaining on the removed intermediate closed-onboarding page.
  await expect(page.getByRole("main").locator('input[name="source"]')).toHaveValue("setup-sent");
  await page.getByRole("main").getByRole("button", { name: "Try the live demo" }).click();
  await expect(page).toHaveURL(/\/shop\//);
});

test("every closed door to a trial now opens the set-up form", async ({ page }) => {
  await page.goto("/onboard");
  await expect(page).toHaveURL(/\/get-set-up\?from=onboard-closed$/);
  await expect(page.getByLabel("Shop name")).toBeVisible();
});

/**
 * One way to ask for a shop (2026-10-22): a switching guide's concierge door
 * is the set-up form, which arrives with that guide's system answered, and the
 * thank-you page links that system's guide.
 */
test("a shop leaving FareHarbor asks from its guide and is sent back to that guide", async ({
  page,
}) => {
  await page.goto("/switching/fareharbor");
  await expect(page.locator('a[href^="mailto:switch@"]')).toHaveCount(0);
  await page.locator('a[href="/get-set-up?from=switching-fareharbor-concierge"]').last().click();
  await expect(page).toHaveURL(/\/get-set-up\?from=switching-fareharbor-concierge$/);
  await expect(page.getByRole("combobox", { name: "Current tool (optional)" })).toHaveValue(
    "booking_system",
  );
  await expect(page.getByRole("radio", { name: "FareHarbor" })).toBeChecked();

  // Paper asks nothing more; dive-shop software asks again.
  await page.getByRole("combobox", { name: "Current tool (optional)" }).selectOption("paper");
  await expect(page.getByRole("radio", { name: "FareHarbor" })).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Current tool (optional)" })
    .selectOption("booking_system");
  await page.getByRole("radio", { name: "FareHarbor" }).check();

  await page.getByLabel("Shop name").fill("Harbor Line Divers");
  await page.getByLabel("Town or region").fill("Islamorada, FL");
  await page.getByRole("radio", { name: "Yes" }).check();
  await page.getByLabel("Your name").fill("Ana Ruiz");
  await page.getByLabel("Email").fill(`fareharbor-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page).toHaveURL(/\/get-set-up\/sent\?uses=booking_system&guide=fareharbor$/);
  await expect(page.getByRole("link", { name: "Export steps for FareHarbor" })).toHaveAttribute(
    "href",
    "/switching/fareharbor?from=setup-sent",
  );
});

test("a shop can request setup without choosing a current tool", async ({ page }) => {
  await page.goto("/get-set-up");
  await page.getByLabel("Shop name").fill("Reef Line Divers");
  await page.getByLabel("Town or region").fill("Key Largo, FL");
  await page.getByLabel("Your name").fill("Ana Ruiz");
  await page.getByLabel("Email").fill(`optional-tool-${Date.now()}@example.com`);
  await page.getByRole("radio", { name: "No", exact: true }).check();
  await expect(page.getByRole("combobox", { name: "Current tool (optional)" })).toHaveValue("");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/get-set-up\/sent$/);
  await expect(page.getByRole("heading", { name: "Request sent", exact: true })).toBeVisible();
});
