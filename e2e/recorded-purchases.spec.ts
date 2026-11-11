import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";

const t = staffTranslator("en-US");

test.describe("record money already received", () => {
  signedInAsOwner();
  test("records a merchandise receipt and a partial external return without Stripe", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/orders");
    await page.getByRole("link", { name: "Record purchase", exact: true }).click();
    const form = page.getByRole("form", { name: "Record purchase", exact: true });
    await form
      .getByLabel("Customer", { exact: true })
      .selectOption({ label: "Priya Sharma · priya.sharma@mail.example" });
    await form.locator('[name="description-0"]').fill("Counter reef shirt");
    await form.locator('[name="quantity-0"]').fill("2");
    await form.locator('[name="unitAmount-0"]').fill("25");
    await form.getByLabel("Included tax (optional)", { exact: true }).fill("3");
    await form.getByLabel("Included tip (optional)", { exact: true }).fill("2");
    await form
      .getByLabel("External receipt or reference (optional)", { exact: true })
      .fill("Desk sale 123");
    await form.getByRole("button", { name: "Record received payment", exact: true }).click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Counter reef shirt", { exact: false })).toBeVisible();
    await expect(page.getByText("Desk sale 123", { exact: false })).toBeVisible();
    await page.getByText("Record money already returned", { exact: true }).click();
    await page.getByLabel("Amount returned (USD)", { exact: true }).fill("10");
    await page.getByLabel("Reason", { exact: true }).fill("One shirt returned");
    await page.getByRole("button", { name: "Record returned money", exact: true }).click();
    await expect(
      page.getByText(t("orders.purchase.refundRecorded"), { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("One shirt returned", { exact: true })).toBeVisible();
    await expect(page.getByText("$40.00", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("One shirt returned", { exact: true })).toBeVisible();
  });
  test("keeps entered receipt fields after validation refusal and closes without a write", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/orders?purchase=1");
    const form = page.getByRole("form", { name: "Record purchase", exact: true });
    await form
      .getByLabel("Customer", { exact: true })
      .selectOption({ label: "Priya Sharma · priya.sharma@mail.example" });
    await form.locator('[name="description-0"]').fill("Must stay typed");
    await form.locator('[name="unitAmount-0"]').fill("1");
    await form.getByLabel("Included tax (optional)", { exact: true }).fill("2");
    const attempt = await form.locator('[name="attemptId"]').inputValue();
    await form.getByRole("button", { name: "Record received payment", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("Check the customer");
    await expect(form.locator('[name="description-0"]')).toHaveValue("Must stay typed");
    await expect(form.locator('[name="attemptId"]')).toHaveValue(attempt);
    await page.locator("[data-add-panel-close]").click();
    await expect(form).toHaveCount(0);
    await page.goBack();
    await expect(page.getByRole("form", { name: "Record purchase", exact: true })).toBeVisible();
  });
});
