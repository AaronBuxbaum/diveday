import { OWNER_NAME } from "../src/db/seed-cast";
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
    // Receipt lines retain the original included tax; retained tax belongs to accounting.
    await expect(page.getByText("$3.00", { exact: true })).toBeVisible();
    await expect(page.getByText("$40.00", { exact: true })).toHaveCSS("font-size", "16px");
    await page.reload();
    await expect(page.getByText("One shirt returned", { exact: true })).toBeVisible();
  });
  for (const viewport of [
    { name: "desktop", width: 1280, height: 800 },
    { name: "phone", width: 390, height: 844 },
  ]) {
    test(`records a walk-in receipt through partial and full external returns (${viewport.name})`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto("/shop/blue-mantis/orders");
      await page.getByRole("link", { name: t("orders.purchase.title"), exact: true }).click();
      const form = page.getByRole("form", { name: t("orders.purchase.title"), exact: true });
      await expect(form.getByLabel("Customer", { exact: true })).toHaveValue("walk-in");
      await expect(form.getByLabel(t("orders.purchase.method"), { exact: true })).toHaveValue(
        "cash",
      );
      await form.getByLabel(t("orders.purchase.item"), { exact: true }).fill("Walk-in reef shirt");
      await form.getByLabel("Quantity", { exact: true }).fill("2");
      await form.getByLabel("Unit price (USD)", { exact: true }).fill("25");
      await form.getByLabel(t("orders.purchase.tax"), { exact: true }).fill("3");
      await form.getByLabel(t("orders.purchase.tip"), { exact: true }).fill("2");
      const reference = `synthetic-money-${viewport.name}`;
      await form.getByLabel(t("orders.purchase.reference"), { exact: true }).fill(reference);
      // Tax and tip are included in the received amount, never added to it.
      await expect(form.getByRole("status")).toHaveText("$50.00");
      await form.getByRole("button", { name: t("orders.purchase.submit"), exact: true }).click();
      await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
      const receiptUrl = page.url();
      const returnAction = page.getByText(t("orders.purchase.refundTitle"), { exact: true });
      const history = page
        .getByRole("heading", { name: t("orders.purchase.refundHistory"), exact: true })
        .locator("..")
        .getByRole("listitem");
      const amount = page.getByLabel(t("orders.purchase.refundAmount", { currency: "USD" }), {
        exact: true,
      });
      const reason = page.getByLabel(t("orders.purchase.refundReason"), { exact: true });
      const submitReturn = page.getByRole("button", {
        name: t("orders.purchase.refundSubmit"),
        exact: true,
      });
      const expectReceipt = async () => {
        await expect(
          page.getByRole("heading", { name: t("orders.purchase.walkIn"), exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: t("orders.detail.diverRecord"), exact: true }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("listitem").filter({ hasText: "Walk-in reef shirt" }),
        ).toHaveText("Walk-in reef shirt (Merchandise × 2)$50.00");
        await expect(
          page.locator("dl").filter({ hasText: t("orders.purchase.includedTax") }),
        ).toHaveText("Included tax$3.00");
        await expect(
          page.getByText(`${t("orders.purchase.includedTip")}: $2.00`, { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText(`${t("orders.purchase.receiptReference")}: ${reference}`, { exact: true }),
        ).toBeVisible();
        await expect(page.getByText(/^Paid in cash /)).toBeVisible();
      };
      const expectBalances = async (status: string, refunded: string, held: string) => {
        await expect(
          page.getByText(status, { exact: true }).and(page.locator("span")),
        ).toBeVisible();
        await expect(
          page
            .getByText(t("orders.detail.refundedSoFar"), { exact: true })
            .and(page.getByRole("term"))
            .locator("..")
            .getByRole("definition"),
        ).toHaveText(refunded);
        await expect(
          page
            .getByText(t("orders.detail.stillHeld"), { exact: true })
            .locator("..")
            .getByRole("definition"),
        ).toHaveText(held);
      };
      await expectReceipt();
      await expect(page.getByText("Paid", { exact: true }).locator("..")).toHaveText("Paid$50.00");
      await returnAction.click();
      await expect(amount).toHaveAttribute("max", "50");
      await amount.fill("60");
      await reason.fill("Synthetic over-return must fail");
      await submitReturn.click();
      expect(await amount.evaluate((input: HTMLInputElement) => input.validity.rangeOverflow)).toBe(
        true,
      );
      await expect(page).toHaveURL(receiptUrl);
      // A reload proves the refused attempt did not create a return.
      await page.reload();
      await expect(page.getByText("Paid", { exact: true })).toBeVisible();
      await expect(history).toHaveCount(0);
      await returnAction.click();
      await amount.fill("10");
      await reason.fill("First cash return");
      await submitReturn.click();
      await expectBalances("Partly refunded", "$10.00", "$40.00");
      await expect(history).toHaveCount(1);
      await expect(history.filter({ hasText: "First cash return" })).toContainText(
        `$10.00 · ${OWNER_NAME}`,
      );
      await page.reload();
      await expectBalances("Partly refunded", "$10.00", "$40.00");
      await returnAction.click();
      await expect(amount).toHaveAttribute("max", "40");
      await amount.fill("40");
      await reason.fill("Remaining cash returned");
      await submitReturn.click();
      await expectBalances("Refunded", "$50.00", "$0.00");
      await expect(returnAction).toHaveCount(0);
      await expect(submitReturn).toHaveCount(0);
      await page.reload();
      await expectBalances("Refunded", "$50.00", "$0.00");
      await expectReceipt();
      await expect(history).toHaveCount(2);
      await expect(history.filter({ hasText: "First cash return" })).toContainText(
        `$10.00 · ${OWNER_NAME}`,
      );
      await expect(history.filter({ hasText: "Remaining cash returned" })).toContainText(
        `$40.00 · ${OWNER_NAME}`,
      );
      await expect(returnAction).toHaveCount(0);
      await expect(submitReturn).toHaveCount(0);
    });
  }
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
