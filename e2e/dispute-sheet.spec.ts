import type { Page } from "@playwright/test";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, READ_ONLY, signedInAs, test } from "./fixtures";

const staff = staffTranslator("en-US");

/**
 * The per-seat dispute sheet (issue #2390): one printable page under an order
 * with the signed waiver, the check-in and every roll-call result, for the
 * owner who has to show a card network that the diver came and dived.
 *
 * READ_ONLY holds: both tests only read. The sheet is a GET page, the owner
 * opens it from a link, and the captain's refusal is a redirect with a notice.
 *
 * The seeded history's deposit orders are raised for real seats (they carry
 * the "Open the departure" link), so the sheet has a seat to describe.
 */

/** From the Orders index to the first seat-linked order, the way staff reach one. */
async function openSeatOrder(page: Page): Promise<string> {
  await page.goto("/shop/blue-mantis/orders?q=Trip+deposit");
  const row = page.locator('ul[aria-labelledby^="orders-day-"] > li');
  await row.filter({ visible: true }).first().waitFor();
  await row.locator('a[href*="/orders/"]').filter({ visible: true }).first().click();
  await page.getByRole("link", { name: "Open the departure" }).waitFor();
  return new URL(page.url()).pathname;
}

test.describe("as the owner", () => {
  signedInAs("owner");

  test("a seat's order opens a dispute sheet with every section and no medical answers", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    await openSeatOrder(page);
    // The sheet's door sits in the header's More menu (visual review A16).
    await page.getByRole("button", { name: staff("orders.detail.more"), exact: true }).click();
    await page.getByRole("link", { name: staff("disputeSheet.door") }).click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}\/print\/dispute$/);

    // The header names the diver and says what the page is and is not.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(staff("disputeSheet.factsOnly"))).toBeVisible();

    // One section for each thing the issue asks for.
    for (const key of [
      "disputeSheet.orderHeading",
      "disputeSheet.waiverHeading",
      "disputeSheet.checkInHeading",
      "disputeSheet.rollCallHeading",
      "disputeSheet.activityHeading",
    ] as const) {
      await expect(page.getByRole("heading", { level: 2, name: staff(key) })).toBeVisible();
    }

    // The order's money, and the roll call as a row per checkpoint.
    await expect(page.getByText(staff("disputeSheet.total"), { exact: true })).toBeVisible();
    const rollCall = page.getByRole("region", { name: staff("disputeSheet.rollCallHeading") });
    await expect(rollCall.getByRole("row")).not.toHaveCount(1);
    await expect(
      rollCall.getByRole("cell", { name: staff("shared.rollCallCheckpoint.departure") }),
    ).toBeVisible();

    // The signed release, or the stated absence of one: never a blank.
    const waiver = page.getByRole("region", { name: staff("disputeSheet.waiverHeading") });
    await expect(waiver.locator("p").first()).toBeVisible();

    // No medical answer in any section. The header says there are none, so the
    // sections are what is read; paired with the positive queries above, which
    // prove the sheet rendered: a missing page would also contain none.
    await expect(
      page.locator("main section").filter({ hasText: /medical|questionnaire|physician/i }),
    ).toHaveCount(0);
    // The toolbar is the screen's, not the paper's.
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("button", { name: staff("print.sheet.door") })).not.toBeVisible();
    await page.emulateMedia({ media: "screen" });
  });
});

test.describe("as a captain", () => {
  signedInAs("captain");

  test("the order offers no dispute sheet, and the address itself refuses with a reason", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    const orderPath = await openSeatOrder(page);
    // Positive pair: the order did render, and the door is not on it.
    await expect(page.getByRole("link", { name: "Diver record" })).toBeVisible();
    await page.getByRole("button", { name: staff("orders.detail.more"), exact: true }).click();
    await expect(page.getByRole("link", { name: staff("disputeSheet.door") })).toHaveCount(0);

    // The refusal redirects to the order with a notice. `FlashParams` strips
    // `?notice=` from the address bar once the order hydrates, which can land
    // before this looks, so either address is the order; the notice's own
    // line below says which refusal it was.
    await page.goto(`${orderPath}/print/dispute`);
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}(\?notice=dispute-not-authorized)?$/);
    await expect(page.getByText(staff("orders.detail.notice.disputeNotAuthorized"))).toBeVisible();
    await expect(
      page.getByRole("heading", { name: staff("disputeSheet.waiverHeading") }),
    ).toHaveCount(0);
  });
});
