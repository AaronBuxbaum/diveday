import type { Page } from "@playwright/test";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { E2E_FROZEN_CLOCK } from "./servers";

const staffCopy = staffTranslator("en-US");

/**
 * **Cash / Card machine: one tap with an eight-second Undo hold** (issue
 * #3030, H-20261024-counter-payment-undo-hold; the send hold of H-20260906-diveday-fill-already-knows). The tap records nothing yet: the row
 * says what will be recorded beside Undo, Undo leaves the order open, and the
 * hold running out records it once.
 */
async function openFirstOpenOrder(page: Page) {
  await page.goto("/shop/blue-mantis/orders?status=open&range=all");
  await page.getByRole("heading", { level: 1, name: "Money" }).waitFor();
  await page
    .locator('ul[aria-labelledby^="orders-day-"] > li')
    .filter({ visible: true })
    .filter({ has: page.getByText("Open", { exact: true }) })
    .first()
    .getByRole("link")
    .first()
    .click();
  await page.getByRole("link", { name: "Diver record" }).waitFor();
  // The tap is a hold only once React owns this form; before that it submits
  // natively (`SendHold`), so wait on this form's own flag, not the page's.
  await expect(
    page.locator("form", { has: page.getByRole("button", { name: "Cash", exact: true }) }),
  ).toHaveAttribute("data-hydrated", "true");
}

test.describe("the counter payment hold", () => {
  signedInAsOwner();

  test("Undo inside the hold records nothing", async ({ page }) => {
    await openFirstOpenOrder(page);
    await page.getByRole("button", { name: "Cash", exact: true }).click();
    const held = page.getByRole("status").filter({ hasText: /^Recording \$[\d.,]+ cash/ });
    await expect(held).toBeVisible();
    await expect(page.getByRole("button", { name: "Card machine", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByRole("button", { name: "Cash", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Open — awaiting payment", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Card machine", exact: true })).toBeEnabled();
  });

  test("the hold running out records the payment once", async ({ page }) => {
    // The hold is eight seconds by decision (H-20260906-diveday-fill-already-knows). The page clock runs the
    // countdown's ticks instead of spending eight real seconds of the budget.
    await page.clock.install({ time: E2E_FROZEN_CLOCK });
    await openFirstOpenOrder(page);
    await page.getByRole("button", { name: "Card machine", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: /^Recording \$[\d.,]+ on the card machine/ }),
    ).toBeVisible();
    await page.clock.runFor(8_500);
    await expect(
      page.getByText(staffCopy("orders.detail.notice.paymentRecordedDemo"), { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Cash", exact: true })).toHaveCount(0);
  });

  test("leaving inside the hold records the payment then, not at the hourly sweep", async ({
    page,
  }) => {
    await openFirstOpenOrder(page);
    const orderUrl = page.url();
    await page.getByRole("button", { name: "Cash", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: /^Recording \$[\d.,]+ cash/ }),
    ).toBeVisible();
    // A navigation inside the app, well inside the eight seconds.
    await page.getByRole("link", { name: "Orders", exact: true }).first().click();
    await page.getByRole("heading", { level: 1, name: "Money" }).waitFor();
    await page.goto(orderUrl);
    await expect(
      page.getByText(staffCopy("orders.detail.status.paid"), { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Cash", exact: true })).toHaveCount(0);
  });
});
