import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { chooseOrderCustomer } from "./order-customer";

const t = staffTranslator("en-US");
test.describe("DESK-11 local ancillary amount due", () => {
  signedInAsOwner();
  // story: DESK-11
  test("creates an unpaid rental and then records the external receipt", async ({ page }) => {
    await page.goto("/shop/blue-mantis/orders?purchase=1");
    const form = page.getByRole("form", { name: t("orders.purchase.title"), exact: true });
    await form.getByRole("radio", { name: t("orders.localDue.open"), exact: true }).check();
    await chooseOrderCustomer(form, "Priya Sharma");
    await form.locator('[name="kind-0"]').selectOption("rental");
    await form.locator('[name="description-0"]').fill("Local regulator rental");
    await form.locator('[name="unitAmount-0"]').fill("25");
    await form.getByRole("button", { name: t("orders.localDue.submit"), exact: true }).click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Local regulator rental", { exact: false })).toBeVisible();
    await expect(page.getByText(t("orders.localDue.help"), { exact: true })).toBeVisible();
    await page
      .getByLabel(`${t("orders.localDue.reference")} (optional)`, { exact: true })
      .fill("Terminal receipt 77");
    await page.getByRole("button", { name: t("orders.localDue.record"), exact: true }).click();
    await expect(page.getByText("Terminal receipt 77", { exact: false })).toBeVisible();
    await expect(page.getByText(t("orders.purchase.refundTitle"), { exact: true })).toBeVisible();
  });
});
