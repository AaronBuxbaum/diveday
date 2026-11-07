import type { Page } from "@playwright/test";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";
import { openTripFromBoard, openTripTab } from "./helpers";

/**
 * **A signed waiver prints as its own sheet** (issue #4142): the record's
 * Print door opens it, the shop's paper carries whose release it is, when it
 * was signed and in which zone, the seal, the medical line and the text the
 * diver signed, and nothing a pen could mistake for a control. The sheet reads
 * what the record reads, so each reader's paper says what their screen says.
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

async function printIt(page: Page) {
  const t = staffTranslator("en-US");
  await page.getByRole("link", { name: t("waiversStaff.record.print"), exact: true }).click();
  await page.waitForURL(/\/waivers\/[^/]+\/print$/);
  const sheet = page.locator(".paper-sheet");
  await expect(sheet.getByRole("heading", { level: 1 })).toHaveText(t("waiversStaff.record.title"));
  await page.emulateMedia({ media: "print" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Rowan Pike");
  await expect(sheet).toContainText("Blue Mantis Divers");
  // The signed time names its zone: a printed release outlives the screen.
  await expect(sheet).toContainText(/E[DS]T/);
  await expect(sheet).toContainText(t("waiversStaff.record.sealLabel"));
  await expect(
    sheet.getByRole("heading", { name: t("waiversStaff.record.releaseHeading") }),
  ).toBeVisible();
  await expect(sheet.locator("a, button, input, select, textarea")).toHaveCount(0);
  const pdf = await page.pdf({ format: "Letter", preferCSSPageSize: true });
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  await page.emulateMedia({ media: "screen" });
  return sheet;
}

test.describe("as the owner", () => {
  signedInAsOwner();

  test("prints the release as a sheet, the physician's name included", async ({ page }) => {
    await openRowansWaiver(page);
    const sheet = await printIt(page);
    await expect(sheet).toContainText("Physician: Dr. Imani Reyes");
  });
});

test.describe("as a divemaster", () => {
  signedInAs("divemaster");

  test("prints what the screen shows them, never the owner's half", async ({ page }) => {
    await openRowansWaiver(page);
    const sheet = await printIt(page);
    await expect(sheet).toContainText("A physician did not clear this diver.");
    await expect(sheet).not.toContainText("Physician:");
  });
});
