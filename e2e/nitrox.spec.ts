import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import { e2eNow } from "./helpers";

async function openWreckTrip(page: Page) {
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Wreck Trip — Spiegel Grove" })
    .getByRole("link")
    .click();
}

test.describe("staff", () => {
  signedInAsOwner();

  test("a verified nitrox card turns a diver's tanks to enriched air on the prep list", async ({
    page,
  }) => {
    // A unique card number keeps the flow self-contained and re-run safe.
    const cardNo = `EANX-T${Date.now()}`;

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
    await card.getByRole("button", { name: "Mark certified" }).click();
    await expect(page.getByRole("status")).toContainText("certified");

    await openWreckTrip(page);
    await page.getByRole("link", { name: "Prep list" }).click();
    await expect(page.getByRole("heading", { name: /Wreck Trip/ })).toBeVisible();

    // The prep list is derived from rental fit, so it always lists tanks and
    // rental kit even when nobody on the boat rents a single piece of kit.
    await expect(page.getByRole("heading", { name: "Rental kit" })).toBeVisible();
    // One tank per diver per dive, and the seeded nitrox request is on the split.
    await expect(page.getByText("one tank per diver per dive")).toBeVisible();
    const tanks = page.getByRole("heading", { name: "Tanks" }).locator("xpath=..");
    await expect(tanks).toContainText("Nitrox");
    // Nothing on this page claims to know what is in a cylinder.
    await expect(page.getByText("DiveDay logs no gas analysis")).toBeVisible();
  });
});

test("a diver without a verified card is not offered nitrox at booking", async ({ page }) => {
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Christ of the Abyss" })
    .getByRole("link")
    .click();
  await page.getByLabel("Name").fill("Nora Quinn");
  // Frozen-clock suffix, not Date.now(): this diver lands on the shared demo
  // shop's People list, which the visual suite screenshots — a real-time
  // suffix here made that snapshot diff on nothing but the clock every run.
  await page.getByLabel("Email").fill(`nora+${e2eNow().getTime()}@example.com`);
  await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
  await expect(page.getByRole("heading", { name: /You're on the boat, Nora/ })).toBeVisible();

  // No card on file, so the request is not offered at all — the diver is told
  // what to do instead of being allowed to ask for a mix they can't breathe.
  await expect(page.getByText("Enriched air needs a verified nitrox card")).toBeVisible();
  await expect(page.locator('input[name="nitrox"]')).toHaveCount(0);
});
