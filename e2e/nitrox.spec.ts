import { expect, type Page, test } from "@playwright/test";
import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";

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

  // Capture a nitrox card for a booked diver, then verify it.
  await page.goto("/shop/nitrox");
  await page
    .locator('select[name="personId"]')
    .selectOption({ label: "June Park · june.park@example.com" });
  await page.locator('input[name="identifier"]').fill(cardNo);
  await page.getByRole("button", { name: "Capture for review" }).click();
  await expect(page.getByRole("status")).toContainText("captured");

  const card = page.locator("li").filter({ hasText: cardNo });
  await card.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("status")).toContainText("verified");

  // Log a fill for that now-certified diver on the wreck trip.
  await page.goto("/shop");
  await page.getByRole("link", { name: /Wreck Trip — Spiegel Grove/ }).click();
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
  await page.goto("/shop");
  await page.getByRole("link", { name: /Wreck Trip — Spiegel Grove/ }).click();
  await page.getByRole("link", { name: "Nitrox fills" }).click();

  // Sam Whitfield (seeded booking, no nitrox card) is present but disabled.
  const option = page.locator("option", { hasText: "Sam Whitfield" });
  await expect(option).toHaveAttribute("disabled", "");
  await expect(option).toContainText("no verified nitrox card");
});
