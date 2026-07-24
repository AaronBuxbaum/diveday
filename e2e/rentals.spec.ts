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
  // default fit is estimated at the set price plus the dive computer — which is
  // default-on but priced as its own line ($45.00 set + $10.00 computer = $55.00).
  const fit = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Rental fit" }) });
  await expect(
    fit.getByText("A full set includes BCD, regulator, wetsuit, mask & fins, and weights."),
  ).toBeVisible();
  await expect(fit.getByText(/Estimated rental: \$55\.00 per person/)).toBeVisible();
  // Target the checkbox specifically: "BCD" also substring-matches the "BCD size"
  // select's label, which would make a bare getByLabel("BCD") ambiguous.
  await fit.getByRole("checkbox", { name: /BCD/ }).uncheck();
  // Dropping the BCD ($15) breaks the set: the remaining four core pieces bill per
  // piece (regulator $15 + wetsuit $12 + mask & fins $8 + weights $5) plus the
  // separately-priced dive computer $10.
  await expect(fit.getByText(/Estimated rental: \$50\.00 per person/)).toBeVisible();
  // Nitrox carries its per-dive surcharge in the label.
  await expect(fit.getByText(/\$12\.00 per dive/)).toBeVisible();
});
