import type { Page } from "@playwright/test";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";
import { openTripFromBoard, openTripTab } from "./helpers";

/**
 * **A signed waiver's screen does not print** (issue #2745). The record is a
 * screen, and a screen never prints; this one can hold a medical answer's
 * words, and paper with them on it is the medical-alerts packet's job, which
 * records who printed it. So Ctrl+P on it, by any reader, gets one line
 * (`ScreenNotPrinted`) and nothing of the record.
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

async function expectOneLine(page: Page) {
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "What they signed" })).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".paper-sheet")).toHaveText(
    staffTranslator("en-US")("waiversStaff.record.screenOnPaper"),
  );
  await expect(main.getByRole("heading", { name: "What they signed" })).not.toBeVisible();
  await expect(page.getByText(/^Physician:/).filter({ visible: true })).toHaveCount(0);
  const pdf = await page.pdf({ format: "Letter", preferCSSPageSize: true });
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  await page.emulateMedia({ media: "screen" });
  await expect(main.getByRole("heading", { name: "What they signed" })).toBeVisible();
}

test.describe("as the owner", () => {
  signedInAsOwner();

  test("prints one line, never the physician or the answers an owner reads", async ({ page }) => {
    await openRowansWaiver(page);
    // On screen the owner reads the physician's name.
    await expect(page.locator("main").getByText("Physician: Dr. Imani Reyes")).toBeVisible();
    await expectOneLine(page);
  });
});

test.describe("as a divemaster", () => {
  signedInAs("divemaster");

  test("prints the same one line", async ({ page }) => {
    await openRowansWaiver(page);
    await expectOneLine(page);
  });
});
