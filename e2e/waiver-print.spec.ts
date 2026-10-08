import type { Page } from "@playwright/test";
import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";
import { openTripFromBoard, openTripTab } from "./helpers";

/**
 * **A signed waiver prints as a document** (plan `rental-tracking`, layer 2):
 * the shop's name, whose release it is, when it was signed and in which zone,
 * the seal, and the text the diver signed — with no door on the paper.
 *
 * The page's permission walls are the reader's (`getSignedWaiverForDiver`):
 * every answer for an owner or manager, only the flagged prompts for anyone
 * else. Paper may not widen that, so both readers print here.
 */

/** Morgan Vale's release: the demo's medical-review training hold. */
async function openMorgansWaiver(page: Page) {
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Afternoon Two-Tank — French Reef");
  await openTripTab(page, "Trip");
  const diver = page
    .locator("li")
    .filter({ has: page.getByText("Morgan Vale", { exact: true }) })
    .filter({ visible: true });
  await diver.getByRole("link", { name: "View signed record" }).click();
  await page.waitForURL(/\/divers\/[^/]+\/waivers\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Signed waiver" })).toBeVisible();
}

test.describe("as the owner", () => {
  signedInAsOwner();

  test("prints the signed waiver as a clean document", async ({ page }) => {
    await openMorgansWaiver(page);
    // The Print button opens the browser's own dialog; a stub stands in for
    // it, so the test proves the tap reaches `window.print` and nothing else.
    await page.evaluate(() => {
      (window as unknown as { printed: number }).printed = 0;
      window.print = () => {
        (window as unknown as { printed: number }).printed += 1;
      };
    });
    await page.getByRole("button", { name: "Print / save PDF" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed))
      .toBe(1);

    // On screen the diver's name is the way back to their record, and the
    // shop's name is the chrome's; neither line of paper exists yet.
    await expect(page.getByRole("link", { name: "Morgan Vale" })).toBeVisible();
    await expect(page.getByText("Blue Mantis Divers", { exact: true })).toBeHidden();

    await page.emulateMedia({ media: "print" });
    await expect(page.getByText("Blue Mantis Divers", { exact: true })).toBeVisible();
    await expect(page.getByText("Diver", { exact: true })).toBeVisible();
    await expect(page.getByText("Morgan Vale", { exact: true })).toBeVisible();
    await expect(page.getByText("Seal", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What they signed" })).toBeVisible();
    // The signed time names its zone: a printed release outlives the screen
    // that knew which shop it came from.
    await expect(page.getByText(/\b(EDT|EST|GMT[+-]\d+)\b/).first()).toBeVisible();
    // No door reaches paper: not Print, not the way back up.
    await expect(page.getByRole("button", { name: "Print / save PDF" })).toBeHidden();
    await expect(page.getByRole("link", { name: "Morgan Vale" })).toBeHidden();
    // An owner reads every answer, so the paper carries the noes too.
    await expect(page.getByText("No", { exact: true }).first()).toBeVisible();
    await page.emulateMedia({ media: "screen" });
  });
});

test.describe("as a divemaster", () => {
  signedInAs("divemaster");

  test("prints only what the screen shows them: the flagged prompts, never every answer", async ({
    page,
  }) => {
    await openMorgansWaiver(page);
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("heading", { name: "What they signed" })).toBeVisible();
    // The flagged prompt is what whoever records a clearance needs to read…
    await expect(page.getByText("Yes", { exact: true }).first()).toBeVisible();
    // …and the answers an owner reads above stay off this reader's paper.
    await expect(page.getByText("No", { exact: true })).toHaveCount(0);
    await page.emulateMedia({ media: "screen" });
  });
});
