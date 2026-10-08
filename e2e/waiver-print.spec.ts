import type { Page } from "@playwright/test";
import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";
import { openTripFromBoard, openTripTab } from "./helpers";

/**
 * **A signed waiver prints as a document** (plan `rental-tracking`, layer 2):
 * the shop's name, whose release it is, when it was signed and in which zone,
 * the seal, and the text the diver signed — with no door on the paper.
 *
 * The page's permission walls are the reader's (`getSignedWaiverForDiver`):
 * the physician's name and every answer for an owner or manager, and for
 * anyone else only what the trip roster already shows them. Paper may not
 * widen that, so both readers print here.
 */

/** Rowan Pike's release: a physician's dated, named refusal above the text. */
async function openRowansWaiver(page: Page) {
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Afternoon Two-Tank — French Reef");
  await openTripTab(page, "Trip");
  const diver = page
    .locator("li")
    .filter({ has: page.getByText("Rowan Pike", { exact: true }) })
    .filter({ visible: true });
  await diver.getByRole("link", { name: "View signed record" }).click();
  await page.waitForURL(/\/divers\/[^/]+\/waivers\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Signed waiver" })).toBeVisible();
}

test.describe("as the owner", () => {
  signedInAsOwner();

  test("prints the signed waiver as a clean document", async ({ page }) => {
    await openRowansWaiver(page);
    const main = page.locator("main");
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
    // page carries no line of its own naming the shop.
    await expect(main.getByRole("link", { name: "Rowan Pike" })).toBeVisible();
    await expect(
      main.getByText("Blue Mantis Divers", { exact: true }).filter({ visible: true }),
    ).toHaveCount(0);

    await page.emulateMedia({ media: "print" });
    await expect(main.getByText("Blue Mantis Divers", { exact: true })).toBeVisible();
    await expect(main.getByText("Diver", { exact: true })).toBeVisible();
    await expect(main.getByText("Seal", { exact: true })).toBeVisible();
    await expect(main.getByText("Sealed and unchanged")).toBeVisible();
    await expect(main.getByRole("heading", { name: "What they signed" })).toBeVisible();
    // The signed time names its zone: a printed release outlives the screen
    // that knew which shop it came from.
    await expect(main.getByText(/\b(EDT|EST)\b/).first()).toBeVisible();
    // An owner reads the physician's name, on paper as on screen.
    await expect(main.getByText("Physician: Dr. Imani Reyes")).toBeVisible();
    // No door reaches paper: not Print, not the way back up.
    await expect(
      page.getByRole("button", { name: "Print / save PDF" }).filter({ visible: true }),
    ).toHaveCount(0);
    await expect(
      main.getByRole("link", { name: "Rowan Pike" }).filter({ visible: true }),
    ).toHaveCount(0);
    await page.emulateMedia({ media: "screen" });
  });
});

test.describe("as a divemaster", () => {
  signedInAs("divemaster");

  test("prints only what the screen shows them, never the owner's half", async ({ page }) => {
    await openRowansWaiver(page);
    const main = page.locator("main");
    await page.emulateMedia({ media: "print" });
    await expect(main.getByRole("heading", { name: "What they signed" })).toBeVisible();
    await expect(
      main.getByText("A physician did not clear this diver.", { exact: false }),
    ).toBeVisible();
    await expect(
      main.getByText("Only an owner or manager can read the full questionnaire."),
    ).toBeVisible();
    // The physician's name is the owner's and manager's to read; the owner's
    // test above finds it on the same paper.
    await expect(main.getByText(/^Physician:/).filter({ visible: true })).toHaveCount(0);
    await page.emulateMedia({ media: "screen" });
  });
});
