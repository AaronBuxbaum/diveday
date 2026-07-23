import { expect, test } from "./fixtures";
import { e2eNow } from "./helpers";

// The demo shop prices its rental gear (src/db/seed.ts): a $45 full set, per-piece
// prices, and a per-dive nitrox surcharge. A diver setting their rental fit should
// see those prices and a running estimate, not a bare "ask the shop" line.
test("a diver sees rental prices and an estimate on the booking confirmation", async ({ page }) => {
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Christ of the Abyss" })
    .getByRole("link")
    .click();
  await page.getByLabel("Name").fill("Rin Tanaka");
  // Frozen-clock suffix (not Date.now()) so the shared demo People list the visual
  // suite screenshots stays pixel-stable across runs.
  await page.getByLabel("Email").fill(`rin+${e2eNow().getTime()}@example.com`);
  await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
  await expect(page.getByRole("heading", { name: /You're on the boat, Rin/ })).toBeVisible();

  // Per-piece prices show next to the gear, the set price is offered, and the
  // default full-set fit is estimated at the cheaper set price ($45.00).
  const fit = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Rental fit" }) });
  await expect(
    fit.getByText("A full set includes a BCD, regulator, wetsuit, mask & fins, and weights."),
  ).toBeVisible();
  await expect(fit.getByText(/Estimated rental: \$45\.00 per person/)).toBeVisible();
  await fit.getByLabel("BCD").uncheck();
  await expect(fit.getByText(/Estimated rental: \$30\.00 per person/)).toBeVisible();
  // Nitrox carries its per-dive surcharge in the label.
  await expect(fit.getByText(/\$12\.00 per dive/)).toBeVisible();
});
