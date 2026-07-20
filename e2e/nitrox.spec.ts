import type { Page } from "@playwright/test";
import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, test } from "./fixtures";

async function signInAsOwner(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(DEV_STAFF_LOGINS.owner.email);
  await page.getByLabel("Password").fill(DEV_STAFF_LOGINS.owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/shop/);
}

test("staff records and verifies a nitrox card, then logs a fill with a derived MOD", async ({
  page,
}) => {
  test.slow(); // several lazily-compiled routes in one flow
  // A unique card number keeps the flow self-contained and re-run safe.
  const cardNo = `EANX-T${Date.now()}`;
  await signInAsOwner(page);

  // Nitrox evidence is handled with the diver's other cards, then verified there.
  await page.goto("/shop/blue-mantis/divers");
  await page.getByRole("link", { name: /June Park/ }).click();
  await page.getByText("Add specialty", { exact: true }).click();
  // The diver page has two capture forms (level card, specialty card), both
  // with name="identifier"/name="specialty" inputs; scope to the specialty
  // form so the selectors resolve unambiguously under strict mode.
  const specialtyForm = page.locator("form", {
    has: page.getByRole("button", { name: "Capture specialty for review" }),
  });
  await specialtyForm.locator('select[name="specialty"]').selectOption("nitrox");
  await specialtyForm.locator('input[name="identifier"]').fill(cardNo);
  await page.getByRole("button", { name: "Capture specialty for review" }).click();
  await expect(page.getByRole("status")).toContainText("captured");

  const card = page.locator("li").filter({ hasText: cardNo });
  await card.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("status")).toContainText("verified");

  // Log a fill for that now-certified diver on the wreck trip.
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Wreck Trip — Spiegel Grove" })
    .getByRole("link")
    .click();
  await page.getByRole("link", { name: "Nitrox fills" }).click();
  await expect(page.getByRole("heading", { name: /Wreck Trip/ })).toBeVisible();

  await page.locator('select[name="bookingId"]').selectOption({ label: "June Park" });
  await page.locator('select[name="gearItemId"]').selectOption({ index: 1 });
  await page.locator('input[name="oxygenPercent"]').fill("32");
  await page.locator('input[name="analyzerSignature"]').fill("June Park");
  await page.getByRole("button", { name: "Log fill" }).click();

  await expect(page.getByRole("status")).toContainText("Fill logged");
  // EAN32 at ppO2 1.4 → 33 m MOD.
  await expect(page.getByText(/MOD 33 m/).first()).toBeVisible();
});

test("an uncertified diver cannot be selected for a fill", async ({ page }) => {
  test.slow();
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Wreck Trip — Spiegel Grove" })
    .getByRole("link")
    .click();
  await page.getByRole("link", { name: "Nitrox fills" }).click();

  // Sam Whitfield (seeded booking, no nitrox card) is present but disabled.
  const option = page.locator("option", { hasText: "Sam Whitfield" });
  await expect(option).toHaveAttribute("disabled", "");
  await expect(option).toContainText("no verified nitrox card");
});
